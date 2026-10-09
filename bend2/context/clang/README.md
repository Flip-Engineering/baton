# Clang context modules

The Clang source contains two selected native modules:

- `clangd` provides definition, type, references, calls, callers, and diagnostics for C and C++ files. It runs `BATON2_CLANGD` when configured, or resolves `clangd` from `PATH`.
- `clang-analyzer` runs the first-party LibTooling extractor for type, calls, diagnostics, authorization, database-access, and control-flow projections.

Both modules implement the native `sourceAnalysis` invocation and return a protocol-version-2 event frame. They read the request's source path and `compile_commands.json` selected by `options.project`; the default is `compile_commands.json` in the request working directory. The extractor receives the matching compile command and the request's position or symbol subject. Provider startup, compiler-database, executable, protocol, and compiler failures remain in the returned result.

For `databaseAccesses`, `options.database` selects a SQLite file relative to the request working directory, through a path string or an object with `engine: "sqlite-schema"` and `path`. The extractor discovers direct callees in the selected function and emits their decoded string literals and source positions. Optional `options.client` restricts this discovery to the named callee. The selected provider prepares each literal's EXPLAIN program on a read-only connection and joins its object accesses to the catalog on that connection. The result records source and catalog references, call and helper identities, read or write plans, and unresolved dynamic statements or engine errors. Relations describe possible static access from the literal at its call site. The provider executes the EXPLAIN program only.

The `clangd` module is included in the package and resolves its executable when invoked. The extractor module is staged only when packaging receives an already-built runtime package with this layout:

```text
context-clang-20
lib/                 linked LLVM and Clang libraries
lib/clang/<version>/include/  Clang resource headers, when used by the build
```

Pass that directory with `--context-clang-package` to package the supplied binary and runtime closure.

## Extractor input

The extractor reads one JSON document on stdin and writes one JSON document on stdout. Its private input contains `version` (1), `operation` (`handlerAnalysis` or `functionSignature`), `directory`, `file`, `arguments`, and `subject`. Optional `pairs` request generated-source mapping. The selected module reads Fossil's `src/main.mk` translation rule when the compile database names the generated input for an original source subject. Empty `helpers` discovers the selected function's direct callees and their literal arguments. Helper definitions are emitted when present in that translation unit. The selected module constructs this input from the native request and matching compile-database entry.

The output records the selected function, source spans, generated/original correspondence, conditions and operands, direct calls, returns, global reads, mapped control-flow graph, derived guard relations, denial routes, compiler diagnostics, helper definitions, and helper call candidates. Refusals exit 2 and write a structured error to stderr. An extraction that runs but fails writes its error in the JSON output.

The provider builds the LibTooling argument vector from the selected compile database entry and places the translation unit path last. The extractor passes the remaining compiler options to LibTooling. LLVM/Clang 20.1.2 is the current Linux build target.

## Build extractor on a remote runner

The extractor requires an LLVM 20 CMake package, Clang 20 headers, the `clang-cpp` shared library, and the runtime resource headers. Build it using that installed package:

```sh
cmake -S bend2/context/clang/extractor -B <build-dir> \
  -DLLVM_DIR=<llvm-prefix>/lib/cmake/llvm \
  -DCMAKE_BUILD_TYPE=Release
cmake --build <build-dir> --target context-clang-20
```

Place the resulting executable and required runtime libraries in the package directory described above before passing it to `package-native.py`.
