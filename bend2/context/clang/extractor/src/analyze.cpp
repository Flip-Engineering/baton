#include "analyze.h"

#include "graph.h"

#include "clang/AST/ASTConsumer.h"
#include "clang/AST/ASTContext.h"
#include "clang/AST/Decl.h"
#include "clang/AST/Expr.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/AST/Stmt.h"
#include "clang/Analysis/CFG.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/LangOptions.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Basic/Version.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Index/USRGeneration.h"
#include "clang/Lex/Lexer.h"
#include "clang/Lex/PPCallbacks.h"
#include "clang/Lex/Preprocessor.h"
#include "clang/Tooling/CompilationDatabase.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/SHA256.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <vector>

namespace ctxclang {

using namespace clang;
using namespace clang::tooling;

const char *const ClangVersionString = CLANG_VERSION_STRING;

namespace {

std::string sha256Hex(llvm::StringRef Bytes) {
  std::array<uint8_t, 32> D = llvm::SHA256::hash(
      llvm::ArrayRef<uint8_t>(reinterpret_cast<const uint8_t *>(Bytes.data()),
                              Bytes.size()));
  static const char *Hex = "0123456789abcdef";
  std::string Out;
  Out.reserve(64);
  for (uint8_t B : D) {
    Out.push_back(Hex[B >> 4]);
    Out.push_back(Hex[B & 0xF]);
  }
  return Out;
}

std::string exprText(const Expr *E, ASTContext &Ctx) {
  if (!E)
    return "";
  llvm::SmallString<256> Buf;
  llvm::raw_svector_ostream OS(Buf);
  PrintingPolicy P(Ctx.getLangOpts());
  P.SuppressTagKeyword = true;
  E->printPretty(OS, nullptr, P);
  return Buf.str().str();
}

std::string typeText(QualType T, ASTContext &Ctx) {
  return T.getCanonicalType().getAsString(Ctx.getPrintingPolicy());
}

std::string declUsr(const Decl *D) {
  if (!D)
    return "";
  llvm::SmallString<128> Buf;
  if (clang::index::generateUSRForDecl(D, Buf))
    return "";
  return Buf.str().str();
}

bool fileOffsetOf(SourceLocation Loc, SourceManager &SM, int64_t &Out) {
  if (Loc.isInvalid())
    return false;
  SourceLocation Exp = SM.getExpansionLoc(Loc);
  FileID FID = SM.getFileID(Exp);
  if (FID.isInvalid())
    return false;
  Out = static_cast<int64_t>(SM.getFileOffset(Exp));
  return true;
}

bool endTokenOffset(SourceLocation TokStart, SourceManager &SM,
                    const LangOptions &LO, int64_t &Out) {
  SourceLocation End = Lexer::getLocForEndOfToken(TokStart, 0, SM, LO);
  return fileOffsetOf(End, SM, Out);
}

std::string filePathFor(SourceManager &SM, FileID FID) {
  if (auto FE = SM.getFileEntryRefForID(FID))
    return FE->getName().str();
  return {};
}

// Byte span of an AST source range in its expansion file, with spelling and
// expansion qualification. Returns false when the range crosses files or is
// invalid; such ranges stay unavailable rather than approximated.
bool spanForRange(SourceRange R, SourceManager &SM, const LangOptions &LO,
                  SpanInfo &Spelling, SpanInfo &Expansion) {
  if (R.getBegin().isInvalid() || R.getEnd().isInvalid())
    return false;
  SourceLocation SB = SM.getSpellingLoc(R.getBegin());
  SourceLocation SE = SM.getSpellingLoc(R.getEnd());
  SourceLocation EB = SM.getExpansionLoc(R.getBegin());
  SourceLocation EE = SM.getExpansionLoc(R.getEnd());
  FileID SF1 = SM.getFileID(SB), SF2 = SM.getFileID(SE);
  FileID EF1 = SM.getFileID(EB), EF2 = SM.getFileID(EE);
  if (SF1 != SF2 || EF1 != EF2)
    return false;
  Expansion.file = filePathFor(SM, EF1);
  if (Expansion.file.empty())
    return false;
  int64_t B, E;
  if (!fileOffsetOf(R.getBegin(), SM, B))
    return false;
  if (!endTokenOffset(R.getEnd(), SM, LO, E))
    return false;
  Expansion.byteStart = B;
  Expansion.byteEnd = E;
  Expansion.expanded = false;
  Spelling = Expansion;
  int64_t SB2, SE2;
  if (fileOffsetOf(SB, SM, SB2) && endTokenOffset(SE, SM, LO, SE2)) {
    Spelling.file = filePathFor(SM, SF1);
    if (Spelling.file.empty())
      Spelling.file = Expansion.file;
    Spelling.byteStart = SB2;
    Spelling.byteEnd = SE2;
    Spelling.expanded = (SF1 != EF1) || (SB2 != B) || (SE2 != E);
  }
  return true;
}

// UTF-16 code-unit column to byte offset inside one file's bytes.
bool utf16ToByteOffset(llvm::StringRef Bytes, int64_t Line, int64_t Column,
                       int64_t &Out) {
  if (Line < 0 || Column < 0)
    return false;
  int64_t CurLine = 0;
  int64_t I = 0;
  const int64_t N = static_cast<int64_t>(Bytes.size());
  while (CurLine < Line) {
    if (I >= N)
      return false;
    if (Bytes[I] == '\n')
      ++CurLine;
    else if (Bytes[I] == '\r') {
      if (I + 1 < N && Bytes[I + 1] == '\n')
        ++I;
      ++CurLine;
    }
    ++I;
  }
  int64_t Units = 0;
  int64_t J = I;
  while (Units < Column) {
    if (J >= N || Bytes[J] == '\n' || Bytes[J] == '\r')
      return false;
    uint8_t C = static_cast<uint8_t>(Bytes[J]);
    int Len = 1;
    if (C >= 0xF0)
      Len = 4;
    else if (C >= 0xE0)
      Len = 3;
    else if (C >= 0xC0)
      Len = 2;
    Units += (Len == 4) ? 2 : 1; // astral plane encodes a surrogate pair
    J += Len;
  }
  Out = J;
  return true;
}

// ---------------------------------------------------------------------------
// Diagnostics capture

class CaptureDiagConsumer : public DiagnosticConsumer {
public:
  std::vector<DiagnosticInfo> Diags;
  void HandleDiagnostic(DiagnosticsEngine::Level Level,
                        const Diagnostic &Info) override {
    DiagnosticConsumer::HandleDiagnostic(Level, Info);
    DiagnosticInfo D;
    switch (Level) {
    case DiagnosticsEngine::Error:
    case DiagnosticsEngine::Fatal:
      D.level = "error";
      break;
    case DiagnosticsEngine::Warning:
      D.level = "warning";
      break;
    case DiagnosticsEngine::Remark:
      D.level = "remark";
      break;
    default:
      D.level = "note";
      break;
    }
    llvm::SmallString<256> Msg;
    Info.FormatDiagnostic(Msg);
    D.message = Msg.str().str();
    SourceManager *SM =
        Info.hasSourceManager() ? &Info.getSourceManager() : nullptr;
    SourceLocation Loc = Info.getLocation();
    if (SM && Loc.isValid()) {
      SourceLocation SL = SM->getSpellingLoc(Loc);
      FileID FID = SM->getFileID(SL);
      D.file = filePathFor(*SM, FID);
      if (!D.file.empty()) {
        D.byteStart = static_cast<int64_t>(SM->getFileOffset(SL));
        D.byteEnd = D.byteStart;
      }
    }
    Diags.push_back(std::move(D));
  }
};

// ---------------------------------------------------------------------------
// Consumed-input hashing: every file that enters the preprocessor.

class HashPPCallbacks : public PPCallbacks {
public:
  std::vector<FileID> Entered;
  SourceManager &SM;
  explicit HashPPCallbacks(SourceManager &S) : SM(S) {}

  void FileChanged(SourceLocation Loc, FileChangeReason Reason,
                   SrcMgr::CharacteristicKind FileType,
                   FileID PrevFID = FileID()) override {
    (void)FileType;
    (void)PrevFID;
    if (Reason != EnterFile || Loc.isInvalid())
      return;
    FileID FID = SM.getFileID(Loc);
    if (FID.isValid())
      Entered.push_back(FID);
  }
};

// ---------------------------------------------------------------------------
// Body visitor: top-level conditions, logical operators, global reads and
// local uses, without entering nested function bodies.

class BodyVisitor : public RecursiveASTVisitor<BodyVisitor> {
public:
  std::vector<const Expr *> TopConditions; // IfStmt conds and logical operators
  std::set<const VarDecl *> GlobalReads;
  std::vector<const DeclRefExpr *> LocalUses;

  bool TraverseLambdaExpr(LambdaExpr *L) {
    (void)L;
    return true; // never enter nested function bodies
  }

  bool VisitIfStmt(IfStmt *S) {
    if (const Expr *C = S->getCond())
      TopConditions.push_back(C->IgnoreParens());
    return true;
  }

  bool VisitBinaryOperator(BinaryOperator *B) {
    if (B->isLogicalOp())
      TopConditions.push_back(B->IgnoreParens());
    return true;
  }

  bool VisitDeclRefExpr(DeclRefExpr *R) {
    if (auto *VD = dyn_cast<VarDecl>(R->getDecl())) {
      if (VD->isLocalVarDeclOrParm())
        LocalUses.push_back(R);
      else
        GlobalReads.insert(VD);
    }
    return true;
  }
};

// ---------------------------------------------------------------------------
// Operand classification per the supported-guard profile.

const Expr *stripLeaf(const Expr *E, bool &Negated) {
  while (true) {
    E = E->IgnoreParens();
    if (auto *IC = dyn_cast<ImplicitCastExpr>(E)) {
      E = IC->getSubExpr();
      continue;
    }
    if (auto *UO = dyn_cast<UnaryOperator>(E)) {
      if (UO->getOpcode() == UO_LNot) {
        Negated = !Negated;
        E = UO->getSubExpr();
        continue;
      }
    }
    return E;
  }
}

// Reject anything outside the supported leaf profile anywhere in the leaf
// expression tree: calls, mutations, dereferences and address taking.
bool containsUnsupported(const Expr *E, std::string &Reason) {
  E = E->IgnoreParens();
  if (auto *IC = dyn_cast<ImplicitCastExpr>(E))
    return containsUnsupported(IC->getSubExpr(), Reason);
  if (isa<CallExpr>(E)) {
    Reason = "callInGuard";
    return true;
  }
  if (auto *BO = dyn_cast<BinaryOperator>(E)) {
    if (BO->isAssignmentOp()) {
      Reason = "mutationInGuard";
      return true;
    }
    if (BO->isLogicalOp())
      return false; // decomposed into leaves by the caller
    Reason = "unsupportedGuardOperator";
    return true;
  }
  if (auto *UO = dyn_cast<UnaryOperator>(E)) {
    UnaryOperatorKind Op = UO->getOpcode();
    if (Op == UO_LNot)
      return containsUnsupported(UO->getSubExpr(), Reason);
    if (Op == UO_Deref) {
      Reason = "pointerDereferenceInGuard";
      return true;
    }
    if (Op == UO_AddrOf) {
      Reason = "addressTakenInGuard";
      return true;
    }
    Reason = "unsupportedGuardOperator";
    return true;
  }
  if (auto *ME = dyn_cast<MemberExpr>(E))
    return containsUnsupported(ME->getBase(), Reason);
  if (isa<DeclRefExpr>(E))
    return false;
  if (isa<IntegerLiteral>(E) || isa<CharacterLiteral>(E) ||
      isa<FloatingLiteral>(E))
    return false;
  Reason = "unsupportedGuardConstruct";
  return true;
}

struct LeafClass {
  OperandInfo Info;
  bool Supported = false;
  std::string Reason;
};

LeafClass classifyLeaf(const Expr *RawLeaf, ASTContext &Ctx,
                       SourceManager &SM, const LangOptions &LO) {
  LeafClass R;
  bool Negated = false;
  const Expr *E = stripLeaf(RawLeaf, Negated);
  R.Info.negated = Negated;

  if (containsUnsupported(RawLeaf, R.Reason))
    return R;

  if (auto *DRE = dyn_cast<DeclRefExpr>(E)) {
    if (auto *ECD = dyn_cast<EnumConstantDecl>(DRE->getDecl())) {
      R.Supported = true;
      R.Info.usr = declUsr(ECD);
      R.Info.name = ECD->getNameAsString();
      R.Info.varKind = "global";
      R.Info.type = typeText(ECD->getType(), Ctx);
      spanForRange(DRE->getSourceRange(), SM, LO, R.Info.spelling,
                   R.Info.spelling);
      return R;
    }
    auto *VD = dyn_cast<VarDecl>(DRE->getDecl());
    if (!VD) {
      R.Reason = "unsupportedGuardConstruct";
      return R;
    }
    QualType T = VD->getType().getCanonicalType();
    if (T.isVolatileQualified()) {
      R.Reason = "volatileOperand";
      return R;
    }
    if (!(T->isIntegerType() || T->isEnumeralType())) {
      R.Reason = "nonscalarOperand";
      return R;
    }
    R.Supported = true;
    R.Info.usr = declUsr(VD);
    R.Info.name = VD->getNameAsString();
    R.Info.varKind = isa<ParmVarDecl>(VD)
                         ? "param"
                         : (VD->isLocalVarDecl() ? "local" : "global");
    R.Info.type = typeText(VD->getType(), Ctx);
    spanForRange(DRE->getSourceRange(), SM, LO, R.Info.spelling,
                 R.Info.spelling);
    return R;
  }

  if (auto *ME = dyn_cast<MemberExpr>(E)) {
    std::vector<const FieldDecl *> Fields;
    const MemberExpr *Cur = ME;
    while (true) {
      auto *FD = dyn_cast<FieldDecl>(Cur->getMemberDecl());
      if (!FD) {
        R.Reason = "unresolvedFieldInGuard";
        return R;
      }
      Fields.push_back(FD);
      if (Cur->isArrow()) {
        R.Reason = "pointerBaseInGuard";
        return R;
      }
      Expr *Base = Cur->getBase()->IgnoreParens();
      if (auto *Outer = dyn_cast<MemberExpr>(Base)) {
        Cur = Outer;
        continue;
      }
      auto *BaseDRE = dyn_cast<DeclRefExpr>(Base);
      if (!BaseDRE) {
        R.Reason = "unresolvedRecordBaseInGuard";
        return R;
      }
      auto *VD = dyn_cast<VarDecl>(BaseDRE->getDecl());
      if (!VD) {
        R.Reason = "unresolvedRecordBaseInGuard";
        return R;
      }
      QualType BT = VD->getType().getCanonicalType();
      if (BT.isVolatileQualified()) {
        R.Reason = "volatileOperand";
        return R;
      }
      if (BT->isPointerType() || !BT->isRecordType()) {
        R.Reason = "nonrecordBaseInGuard";
        return R;
      }
      QualType FT = Fields.front()->getType().getCanonicalType();
      if (FT.isVolatileQualified()) {
        R.Reason = "volatileOperand";
        return R;
      }
      if (!(FT->isIntegerType() || FT->isEnumeralType())) {
        R.Reason = "nonscalarOperand";
        return R;
      }
      R.Supported = true;
      R.Info.usr = declUsr(VD);
      R.Info.name = VD->getNameAsString();
      R.Info.varKind = isa<ParmVarDecl>(VD)
                           ? "param"
                           : (VD->isLocalVarDecl() ? "local" : "global");
      R.Info.type = typeText(VD->getType(), Ctx);
      for (auto It = Fields.rbegin(); It != Fields.rend(); ++It) {
        R.Info.fields.push_back((*It)->getNameAsString());
        R.Info.fieldUsrs.push_back(declUsr(*It));
      }
      spanForRange(ME->getSourceRange(), SM, LO, R.Info.spelling,
                   R.Info.spelling);
      return R;
    }
  }

  R.Reason = "unsupportedGuardConstruct";
  return R;
}

// ---------------------------------------------------------------------------
// Extraction driver

struct CondEntry {
  std::string id;
  const Expr *expr = nullptr;
  std::string kind; // "if" | "logicalAnd" | "logicalOr" | "leaf"
  std::vector<std::pair<const Expr *, bool>> leaves;
  ConditionInfo info;
};

class ExtractConsumer : public ASTConsumer {
public:
  struct CandidateRec {
    HelperCandidate C;
    int64_t blockId = -1;
    const VarDecl *BoundLocal = nullptr;
  };

  ExtractConsumer(const Input &In, Output &Out, HashPPCallbacks *PP)
      : In_(In), Out_(Out), PP_(PP) {}

  void HandleTranslationUnit(ASTContext &Ctx) override {
    Ctx_ = &Ctx;
    SourceManager &SM = Ctx.getSourceManager();
    Out_.clangVersion = ClangVersionString;

    FileID Main = SM.getMainFileID();
    Out_.translationUnitPath = filePathFor(SM, Main);
    if (Out_.translationUnitPath.empty()) {
      Out_.error = "mainFileUnavailable";
      return;
    }
    bool Invalid = false;
    llvm::StringRef MainBytes = SM.getBufferData(Main, &Invalid);
    if (Invalid) {
      Out_.error = "mainBufferUnavailable";
      return;
    }
    Out_.translationUnitSha256 = sha256Hex(MainBytes);

    std::set<FileID> Seen;
    for (FileID FID : PP_->Entered) {
      if (!Seen.insert(FID).second)
        continue;
      ConsumedInput C;
      C.path = filePathFor(SM, FID);
      if (C.path.empty())
        continue;
      bool Inv = false;
      llvm::StringRef Bytes = SM.getBufferData(FID, &Inv);
      if (Inv)
        continue;
      C.sha256 = sha256Hex(Bytes);
      C.role = FID == Main ? "main" : "header";
      Out_.consumedInputs.push_back(std::move(C));
    }

    runOperation(Ctx, SM, Ctx.getLangOpts(), MainBytes);
  }

private:
  std::string resolvePath(const std::string &P) const {
    llvm::SmallString<256> Buf(P);
    if (llvm::sys::path::is_relative(P)) {
      Buf.clear();
      llvm::sys::fs::current_path(Buf);
      llvm::sys::path::append(Buf, P);
    }
    llvm::SmallString<256> Real;
    if (!llvm::sys::fs::real_path(Buf, Real))
      return Real.str().str();
    return Buf.str().str();
  }

  std::string tuRealPath() const {
    return resolvePath(Out_.translationUnitPath);
  }

  FunctionDecl *findNamedFunction(ASTContext &Ctx, const std::string &Name,
                                  int &MatchCount) {
    FunctionDecl *Found = nullptr;
    MatchCount = 0;
    for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
      auto *FD = dyn_cast<FunctionDecl>(D);
      if (!FD || !FD->hasBody() || FD->getNameAsString() != Name)
        continue;
      ++MatchCount;
      Found = FD;
    }
    return Found;
  }

  bool functionInterval(FunctionDecl *FD, SourceManager &SM,
                        const LangOptions &LO, int64_t &Start,
                        int64_t &End, bool &sameFile) {
    SourceRange R = FD->getSourceRange();
    if (R.getBegin().isInvalid() || R.getEnd().isInvalid())
      return false;
    SourceLocation EB = SM.getExpansionLoc(R.getBegin());
    SourceLocation EE = SM.getExpansionLoc(R.getEnd());
    sameFile = SM.getFileID(EB) == SM.getFileID(EE);
    Start = static_cast<int64_t>(SM.getFileOffset(EB));
    return endTokenOffset(R.getEnd(), SM, LO, End);
  }

  int countOriginalOccurrences(llvm::StringRef OrigBytes,
                               llvm::StringRef Segment, int64_t &Pos) {
    int Count = 0;
    int64_t At = -1;
    for (size_t I = OrigBytes.find(Segment); I != llvm::StringRef::npos;
         I = OrigBytes.find(Segment, I + 1)) {
      ++Count;
      At = static_cast<int64_t>(I);
      if (Count > 1)
        break;
    }
    if (Count == 1)
      Pos = At;
    return Count;
  }

  void emitFunctionHeader(ASTContext &Ctx, SourceManager &SM,
                          const LangOptions &LO, FunctionDecl *FD,
                          SelectedFunction &Sel) {
    Sel.name = FD->getNameAsString();
    Sel.usr = declUsr(FD);
    Sel.returnType = FD->getReturnType().getCanonicalType().getAsString(
        Ctx.getPrintingPolicy());
    Sel.variadic = FD->isVariadic();
    for (unsigned I = 0; I < FD->getNumParams(); ++I) {
      const ParmVarDecl *P = FD->getParamDecl(I);
      FormalInfo F;
      F.name = P->getNameAsString();
      F.type = typeText(P->getType(), Ctx);
      spanForRange(P->getSourceRange(), SM, LO, F.spelling, F.spelling);
      Sel.formals.push_back(std::move(F));
    }
    spanForRange(FD->getSourceRange(), SM, LO, Sel.body, Sel.body);
  }

  static CondEntry &entryById(std::vector<CondEntry> &V,
                              const std::string &Id) {
    for (auto &E : V)
      if (E.id == Id)
        return E;
    assert(!"condition id must exist");
    return V.front();
  }

  void runOperation(ASTContext &Ctx, SourceManager &SM,
                    const LangOptions &LO, llvm::StringRef MainBytes) {
    Out_.operation = In_.operation == Input::Operation::HandlerAnalysis
                         ? "handlerAnalysis"
                         : "functionSignature";

    FunctionDecl *Selected = nullptr;
    int64_t GenStart = -1, GenEnd = -1;
    std::string SubjectPath = resolvePath(In_.subject.path);
    bool SubjectIsMain = SubjectPath == tuRealPath();

    if (In_.operation == Input::Operation::FunctionSignature) {
      int MatchCount = 0;
      Selected = findNamedFunction(Ctx, In_.subject.name, MatchCount);
      if (!Selected) {
        Out_.error =
            MatchCount > 1 ? "selectedFunctionAmbiguous" : "functionNotFound";
        return;
      }
    } else if (In_.subject.kind == Subject::Kind::Symbol) {
      Selected = selectSymbolByFile(Ctx, SM, SubjectPath, SubjectIsMain);
      if (!Selected) {
        Out_.error = "functionNotFound";
        return;
      }
    } else {
      std::string Bytes;
      if (SubjectIsMain) {
        Bytes = MainBytes.str();
      } else {
        auto Buf = llvm::MemoryBuffer::getFileAsStream(SubjectPath);
        if (!Buf) {
          Out_.error = "subjectFileUnreadable";
          return;
        }
        Bytes = (*Buf)->getBuffer().str();
      }
      int64_t Off = -1;
      if (!utf16ToByteOffset(Bytes, In_.subject.line, In_.subject.column,
                             Off)) {
        Out_.error = "subjectOffsetOutOfRange";
        return;
      }
      if (SubjectIsMain) {
        Selected = innermostFunctionAt(Ctx, SM, Off);
        if (!Selected) {
          Out_.error = "subjectNotInFunctionBody";
          return;
        }
      } else {
        int MatchCount = 0;
        for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
          auto *FD = dyn_cast<FunctionDecl>(D);
          if (!FD || !FD->hasBody())
            continue;
          int64_t S, E;
          bool Same;
          if (!functionInterval(FD, SM, Ctx.getLangOpts(), S, E, Same) || !Same)
            continue;
          const FilePair *Pair = pairForGenerated();
          if (!Pair || resolvePath(Pair->original) != SubjectPath)
            continue;
          auto Orig = llvm::MemoryBuffer::getFileAsStream(SubjectPath);
          if (!Orig)
            continue;
          llvm::StringRef Seg =
              MainBytes.substr(static_cast<size_t>(S),
                               static_cast<size_t>(E - S));
          int64_t Pos = -1;
          int Count = countOriginalOccurrences((*Orig)->getBuffer(), Seg, Pos);
          if (Count != 1)
            continue;
          if (Off >= Pos && Off < Pos + (E - S)) {
            ++MatchCount;
            if (MatchCount > 1) {
              Out_.error = "ambiguousSubjectMapping";
              return;
            }
            Selected = FD;
            GenStart = S;
            GenEnd = E;
          }
        }
        if (!Selected) {
          Out_.error = "subjectNotInMappedFunction";
          return;
        }
      }
    }

    emitFunctionHeader(Ctx, SM, LO, Selected, Out_.selected);

    // Body interval and generated/original correspondence.
    {
      int64_t S = GenStart, E = GenEnd;
      bool Same = false;
      if (functionInterval(Selected, SM, Ctx.getLangOpts(), S, E, Same) && Same) {
        GenStart = S;
        GenEnd = E;
      }
      const FilePair *Pair = pairForGenerated();
      CorrespondenceInfo &C = Out_.selected.correspondence;
      C.generated = Out_.translationUnitPath;
      C.generatedStart = GenStart;
      C.generatedEnd = GenEnd;
      if (!Pair) {
        C.status = "absent";
        C.reason = "noDeclaredPair";
      } else {
        C.original = Pair->original;
        if (!Same) {
          C.status = "unmapped";
          C.reason = "macroExpandedBoundary";
        } else {
          auto Orig =
              llvm::MemoryBuffer::getFileAsStream(resolvePath(Pair->original));
          if (!Orig) {
            C.status = "unmapped";
            C.reason = "originalUnreadable";
          } else {
            llvm::StringRef Seg = MainBytes.substr(
                static_cast<size_t>(GenStart),
                static_cast<size_t>(GenEnd - GenStart));
            int64_t Pos = -1;
            int Count = countOriginalOccurrences((*Orig)->getBuffer(), Seg, Pos);
            if (Count == 0) {
              C.status = "unmapped";
              C.reason = "originalSegmentMissing";
            } else if (Count > 1) {
              C.status = "unmapped";
              C.reason = "originalSegmentAmbiguous";
            } else {
              C.status = "mapped";
              C.originalStart = Pos;
              C.originalEnd = Pos + (GenEnd - GenStart);
              C.segmentSha256 = sha256Hex(Seg);
            }
          }
        }
      }
    }

    if (In_.operation == Input::Operation::FunctionSignature)
      return; // the signature operation emits the selected function only

    analyzeBody(Ctx, SM, LO, Selected);
  }

  FunctionDecl *innermostFunctionAt(ASTContext &Ctx, SourceManager &SM,
                                    int64_t Offset) {
    FunctionDecl *Best = nullptr;
    int64_t BestSize = -1;
    for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
      auto *FD = dyn_cast<FunctionDecl>(D);
      if (!FD || !FD->hasBody())
        continue;
      int64_t S, E;
      bool Same;
      if (!functionInterval(FD, SM, Ctx.getLangOpts(), S, E, Same) || !Same)
        continue;
      if (Offset >= S && Offset < E) {
        int64_t Size = E - S;
        if (BestSize < 0 || Size < BestSize) {
          Best = FD;
          BestSize = Size;
        }
      }
    }
    return Best;
  }

  FunctionDecl *selectSymbolByFile(ASTContext &Ctx, SourceManager &SM,
                                   const std::string &SubjectPath,
                                   bool SubjectIsMain) {
    FunctionDecl *Found = nullptr;
    int Match = 0;
    for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
      auto *FD = dyn_cast<FunctionDecl>(D);
      if (!FD || !FD->hasBody() || FD->getNameAsString() != In_.subject.name)
        continue;
      bool MatchHere = false;
      if (SubjectIsMain) {
        SourceLocation B = SM.getExpansionLoc(FD->getBeginLoc());
        MatchHere = resolvePath(filePathFor(SM, SM.getFileID(B))) == SubjectPath;
      } else {
        int64_t S, E;
        bool Same;
        if (functionInterval(FD, SM, Ctx.getLangOpts(), S, E, Same) && Same) {
          const FilePair *Pair = pairForGenerated();
          MatchHere = Pair && resolvePath(Pair->original) == SubjectPath;
        }
      }
      if (MatchHere) {
        ++Match;
        Found = FD;
      }
    }
    if (Match != 1)
      return nullptr;
    return Found;
  }

  const FilePair *pairForGenerated() const {
    std::string TU = tuRealPath();
    for (const auto &P : In_.pairs)
      if (resolvePath(P.generated) == TU)
        return &P;
    return nullptr;
  }

  // --- full body analysis -------------------------------------------------

  void analyzeBody(ASTContext &Ctx, SourceManager &SM, const LangOptions &LO,
                   FunctionDecl *FD) {
    CFG::BuildOptions BO;
    BO.setAlwaysAdd(Stmt::CallExprClass);
    BO.setAlwaysAdd(Stmt::ReturnStmtClass);
    std::unique_ptr<CFG> Owned = CFG::buildCFG(FD, FD->getBody(), &Ctx, BO);
    if (!Owned) {
      Out_.error = "cfgUnavailable";
      return;
    }
    CFG *Cfg = Owned.get();
    Cfg_ = Cfg;

    BodyVisitor V;
    V.TraverseStmt(FD->getBody());

    // Condition identities. Every distinct decision expression gets an id:
    // top-level conditions, logical subconditions and the spelled leaves the
    // CFG evaluates.
    std::map<const Expr *, std::string> CondIds;
    std::vector<CondEntry> Conds;
    auto idFor = [&](const Expr *E) -> std::string {
      auto It = CondIds.find(E);
      if (It != CondIds.end())
        return It->second;
      CondEntry CE;
      CE.id = "cond-" + std::to_string(Conds.size());
      CE.expr = E;
      CondIds[E] = CE.id;
      Conds.push_back(CE);
      return CE.id;
    };

    std::vector<std::string> TopIds;
    std::set<std::string> SeenTopIds;
    for (const Expr *E : V.TopConditions) {
      std::string Id = idFor(E);
      if (SeenTopIds.insert(Id).second)
        TopIds.push_back(std::move(Id));
    }
    for (const std::string &Id : TopIds) {
      CondEntry &CE = entryById(Conds, Id);
      if (auto *B = dyn_cast<BinaryOperator>(CE.expr);
          B && B->isLogicalOp())
        CE.kind = B->getOpcode() == BO_LAnd ? "logicalAnd" : "logicalOr";
      else
        CE.kind = "if";
    }

    // Decision mapping from the actual CFG, by in-process expression
    // identity through getTerminatorCondition and getLastCondition.
    struct BlockDecisionRec {
      std::string topId;
      std::string leafId;
      bool inverted = false;
    };
    std::map<int64_t, BlockDecisionRec> Decisions;
    const int64_t EntryId = Cfg->getEntry().getBlockID();
    const int64_t ExitId = Cfg->getExit().getBlockID();

    for (auto *B : *Cfg) {
      if (!B->getTerminator().isValid())
        continue;
      const Stmt *Term = B->getTerminator().getStmt();
      // Clang models short-circuit operators as their own CFG terminators.
      // getTerminatorCondition() returns the operator's LHS, so use the
      // terminator node itself as the logical condition identity.
      const auto *LogicalTerm = dyn_cast<BinaryOperator>(Term);
      const Expr *TC = dyn_cast_or_null<Expr>(
          B->getTerminatorCondition(/*StripParens=*/true));
      const Expr *TopKey = LogicalTerm && LogicalTerm->isLogicalOp()
                               ? LogicalTerm->IgnoreParens()
                               : (TC ? TC->IgnoreParens() : nullptr);
      if (!TopKey && Term) {
        if (auto *IS = dyn_cast<IfStmt>(Term))
          if (IS->getCond())
            TopKey = IS->getCond()->IgnoreParens();
      }
      if (!TopKey)
        continue;
      std::string TopId;
      auto It = CondIds.find(TopKey);
      if (It != CondIds.end())
        TopId = It->second;
      if (TopId.empty())
        continue; // condition outside the selected body or ambiguous
      const Expr *LC = B->getLastCondition();
      const Expr *LeafKey = LC ? LC->IgnoreParens() : TopKey;
      // The decision tree represents logical negation as a Not node, so its
      // leaf identity is the operand below any leading `!` operators.
      bool Inverted = false;
      while (true) {
        if (const auto *IC = dyn_cast<ImplicitCastExpr>(LeafKey)) {
          LeafKey = IC->getSubExpr()->IgnoreParens();
          continue;
        }
        if (const auto *UO = dyn_cast<UnaryOperator>(LeafKey)) {
          if (UO->getOpcode() == UO_LNot) {
            Inverted = !Inverted;
            LeafKey = UO->getSubExpr()->IgnoreParens();
            continue;
          }
        }
        break;
      }
      std::string LeafId = idFor(LeafKey);
      CondEntry &LE = entryById(Conds, LeafId);
      if (LE.kind.empty()) {
        LE.kind = "leaf";
        LE.leaves.push_back({LeafKey, Inverted});
      }
      Decisions[B->getBlockID()] = {TopId, LeafId, Inverted};
    }

    // Logical trees per top-level condition, with spelled leaves registered.
    std::map<std::string, std::unique_ptr<LogicTree>> Trees;
    std::function<std::unique_ptr<LogicTree>(const Expr *, const Expr *)>
        buildTree = [&](const Expr *E, const Expr *Top) -> std::unique_ptr<LogicTree> {
      E = E->IgnoreParens();
      if (auto *IC = dyn_cast<ImplicitCastExpr>(E))
        return buildTree(IC->getSubExpr(), Top);
      auto Node = std::make_unique<LogicTree>();
      if (auto *UO = dyn_cast<UnaryOperator>(E)) {
        if (UO->getOpcode() == UO_LNot) {
          Node->op = LogicTree::Op::Not;
          Node->children.push_back(buildTree(UO->getSubExpr(), Top));
          return Node;
        }
      }
      if (auto *BO = dyn_cast<BinaryOperator>(E)) {
        if (BO->isLogicalOp()) {
          Node->op = BO->getOpcode() == BO_LAnd ? LogicTree::Op::And
                                                : LogicTree::Op::Or;
          Node->children.push_back(buildTree(BO->getLHS(), Top));
          Node->children.push_back(buildTree(BO->getRHS(), Top));
          return Node;
        }
      }
      // A leaf whose spelling is the whole condition decides the condition
      // value directly at its block.
      Node->op = LogicTree::Op::Leaf;
      Node->whole = (E == Top);
      Node->leafId = idFor(E);
      return Node;
    };
    for (const std::string &Id : TopIds) {
      const Expr *TopExpr = entryById(Conds, Id).expr;
      Trees.insert_or_assign(Id, buildTree(TopExpr, TopExpr));
      // Register the tree's leaves on the condition entry for operand info.
      std::vector<std::pair<const Expr *, bool>> Leaves;
      std::function<void(const LogicTree &, bool)> gather =
          [&](const LogicTree &N, bool Negated) {
            if (N.op == LogicTree::Op::Leaf) {
              CondEntry &LE = entryById(Conds, N.leafId);
              Leaves.push_back({LE.expr, Negated});
              return;
            }
            if (N.op == LogicTree::Op::Not) {
              gather(*N.children.front(), !Negated);
              return;
            }
            for (const auto &C : N.children)
              gather(*C, Negated);
          };
      gather(*Trees[Id], false);
      entryById(Conds, Id).leaves = std::move(Leaves);
    }

    // Fill and emit condition info.
    for (CondEntry &CE : Conds) {
      if (CE.kind.empty()) {
        CE.kind = "leaf";
        if (CE.leaves.empty())
          CE.leaves.push_back({CE.expr, false});
      }
      CE.info.id = CE.id;
      CE.info.exprKind = CE.kind;
      CE.info.exprText = exprText(CE.expr, Ctx);
      spanForRange(SourceRange(CE.expr->getBeginLoc(), CE.expr->getEndLoc()),
                   SM, LO, CE.info.spelling, CE.info.expansion);
      bool Supported = true;
      std::string Reason;
      for (const auto &[L, Negated] : CE.leaves) {
        LeafClass LC = classifyLeaf(L, Ctx, SM, LO);
        LC.Info.negated = LC.Info.negated != Negated;
        if (LC.Supported)
          CE.info.operands.push_back(LC.Info);
        else {
          Supported = false;
          if (Reason.empty())
            Reason = LC.Reason;
        }
      }
      CE.info.supported = Supported;
      CE.info.unsupportedReason = Reason;
      Out_.conditions.push_back(CE.info);
    }

    // Globals read by the function.
    {
      std::set<std::string> SeenUsr;
      for (const VarDecl *VD : V.GlobalReads) {
        OperandInfo O;
        O.usr = declUsr(VD);
        if (SeenUsr.count(O.usr))
          continue;
        SeenUsr.insert(O.usr);
        O.name = VD->getNameAsString();
        O.varKind = "global";
        O.type = typeText(VD->getType(), Ctx);
        spanForRange(VD->getSourceRange(), SM, LO, O.spelling, O.spelling);
        Out_.globals.push_back(std::move(O));
      }
    }

    // Blocks, elements and edges.
    struct BlockFacts {
      std::vector<std::string> callIds;
      std::string returnId;
      std::vector<std::pair<int64_t, int64_t>> ranges;
    };
    std::map<int64_t, BlockFacts> Facts;
    int CallN = 0, RetN = 0;
    for (auto *B : *Cfg) {
      const int64_t Id = B->getBlockID();
      BlockFacts &F = Facts[Id];
      for (auto &El : *B) {
        std::optional<CFGStmt> S = El.getAs<CFGStmt>();
        if (!S)
          continue;
        const Stmt *St = S->getStmt();
        if (auto *CE = dyn_cast<CallExpr>(St)) {
          CallInfo C;
          C.id = "call-" + std::to_string(CallN++);
          C.blockId = Id;
          const Expr *Callee = CE->getCallee()->IgnoreParenImpCasts();
          const FunctionDecl *Direct = nullptr;
          if (auto *DRE = dyn_cast<DeclRefExpr>(Callee))
            Direct = dyn_cast<FunctionDecl>(DRE->getDecl());
          if (Direct) {
            C.direct = true;
            const FunctionDecl *Canon = Direct->getCanonicalDecl();
            C.usr = declUsr(Canon);
            C.name = Canon->getNameAsString();
            for (unsigned I = 0; I < Canon->getNumParams(); ++I)
              C.parameterTypes.push_back(
                  typeText(Canon->getParamDecl(I)->getType(), Ctx));
          } else {
            C.calleeUnavailable = true;
            C.calleeUnavailableReason = "indirectCallee";
          }
          unsigned Index = 0;
          for (auto *A : CE->arguments()) {
            CallArgInfo AInfo;
            AInfo.index = Index;
            if (Direct && Index < C.parameterTypes.size())
              AInfo.parameterType = C.parameterTypes[Index];
            spanForRange(A->getSourceRange(), SM, LO, AInfo.spelling,
                         AInfo.spelling);
            C.arguments.push_back(std::move(AInfo));
            ++Index;
          }
          spanForRange(CE->getSourceRange(), SM, LO, C.spelling, C.expansion);
          F.callIds.push_back(C.id);
          F.ranges.push_back({C.spelling.byteStart, C.spelling.byteEnd});
          BlockRanges_[Id].push_back({C.spelling.byteStart, C.spelling.byteEnd});
          CallExprOf_[St] = CE;
          CallIds_[St] = C.id;
          Out_.calls.push_back(std::move(C));
          continue;
        }
        if (auto *RS = dyn_cast<ReturnStmt>(St)) {
          ReturnInfo R;
          R.id = "ret-" + std::to_string(RetN++);
          R.blockId = Id;
          spanForRange(RS->getSourceRange(), SM, LO, R.spelling, R.spelling);
          F.returnId = R.id;
          Out_.returns.push_back(std::move(R));
          continue;
        }
        int64_t B2, E2;
        if (fileOffsetOf(St->getBeginLoc(), SM, B2) &&
            endTokenOffset(St->getEndLoc(), SM, LO, E2)) {
          F.ranges.push_back({B2, E2});
          BlockRanges_[Id].push_back({B2, E2});
        }
      }
    }

    // Reachability from entry.
    std::set<int64_t> Reach;
    {
      std::vector<int64_t> Stack{EntryId};
      while (!Stack.empty()) {
        int64_t Cur = Stack.back();
        Stack.pop_back();
        if (!Reach.insert(Cur).second)
          continue;
        for (auto *B : *Cfg) {
          if (B->getBlockID() != Cur)
            continue;
          for (CFGBlock::AdjacentBlock Adj : B->succs()) {
            if (const CFGBlock *S = Adj)
              Stack.push_back(S->getBlockID());
          }
        }
      }
    }

    // Emit blocks and edges.
    std::vector<GraphEdge> Edges;
    for (auto *B : *Cfg) {
      const int64_t Id = B->getBlockID();
      CfgBlock CB;
      CB.id = Id;
      CB.entry = Id == EntryId;
      CB.exit = Id == ExitId;
      CB.unreachable = !Reach.count(Id);
      auto DecIt = Decisions.find(Id);
      if (DecIt != Decisions.end()) {
        const Stmt *Term = B->getTerminator().getStmt();
        if (auto *BO = dyn_cast_or_null<BinaryOperator>(Term))
          CB.terminatorKind =
              BO->getOpcode() == BO_LAnd ? "logicalAnd" : "logicalOr";
        else if (isa<IfStmt>(Term))
          CB.terminatorKind = "if";
        CB.conditionId = DecIt->second.topId;
        CB.lastConditionOperandId = DecIt->second.leafId;
      }
      Out_.cfg.blocks.push_back(CB);

      GraphNode GN;
      auto Fit = Facts.find(Id);
      if (Fit != Facts.end()) {
        GN.callIds = Fit->second.callIds;
        GN.returnId = Fit->second.returnId;
        GN.isReturn = !Fit->second.returnId.empty();
      }
      GN.isExit = Id == ExitId;
      Nodes_[Id] = GN;

      bool Decision = DecIt != Decisions.end();
      size_t SuccIdx = 0;
      size_t SuccCount = B->succ_size();
      for (CFGBlock::AdjacentBlock Adj : B->succs()) {
        GraphEdge E;
        E.from = Id;
        if (const CFGBlock *S = Adj) {
          E.to = S->getBlockID();
          if (!Adj.isReachable())
            E.label = "unreachable";
          else if (Decision && SuccCount == 2) {
            // Successor order for IfStmt and short-circuit decisions is
            // bound to the LLVM 20 CFG implementation and exercised by the
            // extractor fixtures against known-shaped control flow.
            E.label = SuccIdx == 0 ? "true" : "false";
            if (DecIt->second.inverted)
              E.label = E.label == "true" ? "false" : "true";
          } else
            E.label = "nonDecision";
        } else {
          E.to = -1;
          E.label = "null";
        }
        Edges.push_back(E);
        Out_.cfg.edges.push_back({E.from, E.to, E.label});
        ++SuccIdx;
      }
    }
    Out_.cfg.entryId = EntryId;
    Out_.cfg.exitId = ExitId;

    // Guard derivation over every supported condition and every call. Whole
    // condition exits come from buildDecision; any mapping disagreement with
    // the logical tree refuses the relation instead of inferring a value.
    std::vector<GuardRelation> Unavailable;
    for (const std::string &TopId : TopIds) {
      const CondEntry &CE = entryById(Conds, TopId);
      if (!CE.info.supported)
        continue;
      std::map<std::string, int64_t> LeafBlockOf;
      for (const auto &KV : Decisions)
        if (KV.second.topId == TopId)
          LeafBlockOf[KV.second.leafId] = KV.first;
      DecisionBuildResult Built =
          buildDecision(TopId, *Trees[TopId], LeafBlockOf, Edges);
      for (const CallInfo &Call : Out_.calls) {
        if (!Built.ok) {
          GuardRelation G;
          G.conditionId = TopId;
          G.callId = Call.id;
          G.status = "unavailable";
          G.unavailableReason = Built.reason;
          Unavailable.push_back(std::move(G));
          continue;
        }
        GuardRelation Best;
        bool HaveUnavailable = false;
        for (int Polarity = 0; Polarity < 2; ++Polarity) {
          GuardSolveInput In;
          In.entryId = EntryId;
          In.callBlockId = Call.blockId;
          In.callId = Call.id;
          In.acceptedValue = Polarity == 1;
          In.decision = Built.decision;
          In.edges = Edges;
          In.nodes = Nodes_;
          GuardSolveOutput R = solveGuard(In);
          GuardRelation G;
          G.conditionId = TopId;
          G.callId = Call.id;
          G.acceptedValue = Polarity == 1;
          G.status = R.derived ? "derived" : "unavailable";
          G.unavailableReason = R.reason;
          for (int64_t E : R.cutEdges)
            G.cutEdges.push_back(E);
          for (const auto &Rt : R.deniedRoutes) {
            DenialRoute DR;
            for (const auto &Ev : Rt.evaluated) {
              RouteOperand RO;
              RO.conditionId = Ev.conditionId;
              RO.operandLeafId = Ev.operandLeafId;
              RO.outcome = Ev.outcome;
              DR.evaluated.push_back(RO);
            }
            DR.edges = Rt.edges;
            DR.returnId = Rt.returnId;
            DR.interveningCalls = Rt.interveningCalls;
            G.deniedRoutes.push_back(std::move(DR));
          }
          G.acceptedInterveningCalls = R.acceptedInterveningCalls;
          if (R.derived)
            Out_.guards.push_back(std::move(G));
          else {
            if (!HaveUnavailable ||
                rankOfReason(G.unavailableReason) <
                    rankOfReason(Best.unavailableReason))
              Best = std::move(G);
            HaveUnavailable = true;
          }
        }
        if (HaveUnavailable)
          Unavailable.push_back(std::move(Best));
      }
    }
    for (auto &G : Unavailable)
      Out_.guards.push_back(std::move(G));

    emitHelpers(Ctx, SM, LO, FD, V);
  }

  static size_t rankOfReason(const std::string &R) {
    static const std::vector<std::string> Priority = {
        "acceptedCutSetDoesNotDisconnectCall", "denialReachesCall",
        "denialSideReachesCycle", "denialSideHasUnaccountedAlternative",
        "denialSideDeadEnd", "denialWitnessUnavailable",
        "denialTargetUnmapped", "decisionMappingIncomplete",
        "callUnreachableFromEntry", "noAcceptedExitEdges"};
    for (size_t I = 0; I < Priority.size(); ++I)
      if (Priority[I] == R)
        return I;
    return Priority.size();
  }

  void emitHelpers(ASTContext &Ctx, SourceManager &SM, const LangOptions &LO,
                   FunctionDecl *FD, BodyVisitor &V) {
    (void)LO;
    std::map<std::string, const FunctionDecl *> HelperOfName;
    for (const std::string &Name : In_.helpers) {
      const FunctionDecl *H = nullptr;
      int Match = 0;
      std::set<const FunctionDecl *> SeenDefinitions;
      for (auto *D : Ctx.getTranslationUnitDecl()->decls()) {
        auto *Declaration = dyn_cast<FunctionDecl>(D);
        if (!Declaration || Declaration->getNameAsString() != Name)
          continue;
        const FunctionDecl *Cand = Declaration->getDefinition();
        if (!Cand || !SeenDefinitions.insert(Cand).second)
          continue;
        ++Match;
        H = Cand;
      }
      if (Match != 1)
        continue;
      HelperOfName[Name] = H;
      HelperDefinition HD;
      HD.name = Name;
      HD.usr = declUsr(H->getCanonicalDecl());
      HD.returnType = typeText(H->getReturnType(), Ctx);
      HD.variadic = H->isVariadic();
      for (unsigned I = 0; I < H->getNumParams(); ++I) {
        const ParmVarDecl *P = H->getParamDecl(I);
        FormalInfo F;
        F.name = P->getNameAsString();
        F.type = typeText(P->getType(), Ctx);
        spanForRange(P->getSourceRange(), SM, LO, F.spelling, F.spelling);
        HD.formals.push_back(std::move(F));
      }
      spanForRange(H->getSourceRange(), SM, LO, HD.body, HD.body);
      Out_.helperDefinitions.push_back(std::move(HD));
    }

    // Candidate calls inside the selected function.
    std::vector<CandidateRec> Cands;
    for (const CallInfo &Call : Out_.calls) {
      if (!Call.direct)
        continue;
      std::string HelperName;
      for (const auto &KV : HelperOfName) {
        if (declUsr(KV.second->getCanonicalDecl()) == Call.usr) {
          HelperName = KV.first;
          break;
        }
      }
      if (HelperName.empty())
        continue;
      CandidateRec R;
      R.C.callId = Call.id;
      R.C.helperName = HelperName;
      R.C.helperUsr = Call.usr;
      R.blockId = Call.blockId;
      Cands.push_back(std::move(R));
    }

    for (const auto &KV : CallExprOf_) {
      const CallExpr *CE = KV.second;
      auto It = CallIds_.find(KV.first);
      if (It == CallIds_.end())
        continue;
      const std::string &CallId = It->second;
      for (CandidateRec &R : Cands) {
        if (R.C.callId != CallId)
          continue;
        unsigned Index = 0;
        for (auto *Arg : CE->arguments()) {
          if (auto *SL = dyn_cast<StringLiteral>(Arg->IgnoreParens())) {
            SqlLiteralInfo L;
            L.argumentIndex = Index;
            llvm::StringRef Val = SL->getString();
            L.valueSha256 = sha256Hex(Val);
            L.valueLength = static_cast<int64_t>(Val.size());
            L.hasPercent = Val.contains('%');
            L.hasNul = Val.contains('\0');
            spanForRange(SL->getSourceRange(), SM, LO, L.rawSource,
                         L.rawSource);
            R.C.sqlLiterals.push_back(std::move(L));
          }
          ++Index;
        }
        if (CE->getNumArgs() > 0) {
          const Expr *A0 = CE->getArg(0)->IgnoreParens();
          if (auto *UO = dyn_cast<UnaryOperator>(A0)) {
            if (UO->getOpcode() == UO_AddrOf) {
              if (auto *DRE =
                      dyn_cast<DeclRefExpr>(UO->getSubExpr()->IgnoreParens())) {
                if (auto *VD = dyn_cast<VarDecl>(DRE->getDecl())) {
                  R.BoundLocal = VD;
                  R.C.boundLocalUsr = declUsr(VD);
                  R.C.boundLocalName = VD->getNameAsString();
                }
              }
            }
          }
        }
      }
    }

    lineage(Ctx, SM, FD, Cands, V);
    for (auto &R : Cands)
      Out_.helperCandidates.push_back(std::move(R.C));
  }

  void lineage(ASTContext &Ctx, SourceManager &SM, FunctionDecl *FD,
               std::vector<CandidateRec> &Cands, BodyVisitor &V) {
    (void)Ctx;
    (void)FD;
    std::map<std::string, std::vector<size_t>> ByLocal;
    for (size_t I = 0; I < Cands.size(); ++I) {
      if (!Cands[I].BoundLocal)
        continue;
      ByLocal[declUsr(Cands[I].BoundLocal)].push_back(I);
    }

    for (auto &KV : ByLocal) {
      if (KV.second.size() < 2)
        continue;
      const VarDecl *VD = Cands[KV.second[0]].BoundLocal;
      std::vector<int64_t> UseOffsets;
      for (const DeclRefExpr *R : V.LocalUses) {
        if (R->getDecl() != VD)
          continue;
        int64_t Off;
        if (fileOffsetOf(R->getBeginLoc(), SM, Off))
          UseOffsets.push_back(Off);
      }
      for (size_t J = 1; J < KV.second.size(); ++J) {
        CandidateRec &Prepare = Cands[KV.second[J - 1]];
        CandidateRec &Step = Cands[KV.second[J]];
        std::vector<int64_t> Path =
            acyclicEntryPath(Prepare.blockId, Step.blockId);
        if (Path.empty()) {
          Step.C.lineageStatus = "unavailable";
          Step.C.lineageReason = "noAcyclicEntryPath";
          continue;
        }
        std::vector<std::string> Intervening;
        bool Refused = false;
        auto Pb = std::find(Path.begin(), Path.end(), Prepare.blockId);
        auto Sb = std::find(Path.begin(), Path.end(), Step.blockId);
        for (int64_t Off : UseOffsets) {
          int64_t UB = blockForOffset(Off);
          if (UB < 0)
            continue;
          if (Pb == Path.end() || Sb == Path.end() || Pb >= Sb)
            continue;
          if (UB == *Pb || UB == *Sb)
            continue;
          if (std::find(Pb + 1, Sb, UB) != Sb) {
            Refused = true;
            char Buf[32];
            std::snprintf(Buf, sizeof(Buf), "use@block:%lld", (long long)UB);
            Intervening.push_back(Buf);
          }
        }
        if (Refused) {
          Step.C.lineageStatus = "refused";
          Step.C.lineageReason = "interveningUseOfBoundLocal";
          Step.C.interveningUses = std::move(Intervening);
        } else {
          Step.C.lineageStatus = "derived";
        }
      }
    }
  }

  std::vector<int64_t> acyclicEntryPath(int64_t Through, int64_t Target) {
    std::vector<int64_t> Path;
    std::set<int64_t> OnStack;
    int Found = 0;
    std::vector<int64_t> LastPath;
    std::function<void(int64_t)> Walk = [&](int64_t Cur) {
      if (Found > 1)
        return;
      if (OnStack.count(Cur))
        return; // back edge
      OnStack.insert(Cur);
      Path.push_back(Cur);
      if (Cur == Target) {
        if (std::find(Path.begin(), Path.end(), Through) != Path.end()) {
          ++Found;
          if (Found == 1)
            LastPath = Path;
        }
      } else {
        for (auto *B : *Cfg_) {
          if (B->getBlockID() != Cur)
            continue;
          for (CFGBlock::AdjacentBlock Adj : B->succs()) {
            if (const CFGBlock *S = Adj)
              if (Adj.isReachable())
                Walk(S->getBlockID());
          }
        }
      }
      Path.pop_back();
      OnStack.erase(Cur);
    };
    Walk(Cfg_->getEntry().getBlockID());
    if (Found != 1)
      return {};
    return LastPath;
  }

  int64_t blockForOffset(int64_t Offset) {
    for (auto &KV : BlockRanges_)
      for (auto &Rg : KV.second)
        if (Offset >= Rg.first && Offset < Rg.second)
          return KV.first;
    return -1;
  }

  const Input &In_;
  Output &Out_;
  HashPPCallbacks *PP_;
  ASTContext *Ctx_ = nullptr;
  CFG *Cfg_ = nullptr;
  std::map<int64_t, GraphNode> Nodes_;
  std::map<int64_t, std::vector<std::pair<int64_t, int64_t>>> BlockRanges_;
  std::map<const void *, const CallExpr *> CallExprOf_;
  std::map<const void *, std::string> CallIds_;
};

class ExtractAction : public ASTFrontendAction {
public:
  ExtractAction(const Input &In, Output &Out) : In_(In), Out_(Out) {}

  std::unique_ptr<ASTConsumer>
  CreateASTConsumer(CompilerInstance &CI, StringRef) override {
    PP_ = new HashPPCallbacks(CI.getSourceManager());
    CI.getPreprocessor().addPPCallbacks(std::unique_ptr<PPCallbacks>(PP_));
    return std::make_unique<ExtractConsumer>(In_, Out_, PP_);
  }

private:
  const Input &In_;
  Output &Out_;
  HashPPCallbacks *PP_ = nullptr;
};

class ExtractActionFactory : public FrontendActionFactory {
public:
  ExtractActionFactory(const Input &In, Output &Out) : In_(In), Out_(Out) {}
  std::unique_ptr<FrontendAction> create() override {
    return std::make_unique<ExtractAction>(In_, Out_);
  }

private:
  const Input &In_;
  Output &Out_;
};

} // namespace

bool runAnalysis(const Input &In, Output &Out) {
  if (In.arguments.size() < 2) {
    Out.error = "argumentsTooShort";
    return false;
  }
  std::vector<std::string> Flags(In.arguments.begin() + 1,
                                 In.arguments.end() - 1);
  const std::string &Last = In.arguments.back();
  // The command's translation unit must be the input file (filename check;
  // the caller chdirs into the declared directory first).
  if (llvm::sys::path::filename(Last) != llvm::sys::path::filename(In.file)) {
    Out.error = "fileAndArgumentsMismatch";
    return false;
  }

  FixedCompilationDatabase DB(In.directory, Flags);
  std::vector<std::string> Files{In.file};
  ClangTool Tool(DB, Files);

  ExtractActionFactory Factory(In, Out);
  CaptureDiagConsumer DiagConsumer;
  Tool.setDiagnosticConsumer(&DiagConsumer);
  int Code = Tool.run(&Factory);
  Out.diagnostics = std::move(DiagConsumer.Diags);
  if (Code != 0 && Out.error.empty())
    Out.error = "frontendFailed";
  return Out.error.empty();
}

} // namespace ctxclang
