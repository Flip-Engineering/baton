# The row parsing of bend2/src/host/compile-queue.bend: a recursive definition
# builds each Artifact and conses it onto the accumulator, so the emitted C
# references CID_ARTIFACT from a spin function. spin_cid_definition.ts compiles
# this file and checks that the CID table defines every macro the C uses.
import Base
import ../../../src/git/text.bend as Tx

type Artifact is Data:
  Artifact{name: String, path: String}

type ArtifactRowCandidate is Data:
  ValidArtifactRow{value: Artifact}
  InvalidArtifactRow{}

def artifact_row_candidate(parts: List<&1, String>) -> ArtifactRowCandidate:
  match parts:
    case name <> path <> Nil{}: ValidArtifactRow{Artifact{name, path}}
    case other: InvalidArtifactRow{}

def artifact_row_add(candidate: ArtifactRowCandidate, acc: List<&2,Artifact>) -> List<&2,Artifact>:
  match candidate:
    case ValidArtifactRow{value}: Con{value, acc}
    case InvalidArtifactRow{}: acc

def artifact_rows_go(rows: List<&1,String>, acc: List<&2,Artifact>) -> List<&2,Artifact>:
  match rows:
    case Nil{}: List.reverse(&2, Artifact, acc)
    case +row <> rest:
      artifact_rows_go(rest, artifact_row_add(artifact_row_candidate(Tx.split_tabs(row)), acc))

def artifact_rows(rows: List<&1,String>) -> List<&2,Artifact>:
  artifact_rows_go(rows, Nil{})

def artifact_names(artifacts: List<&2,Artifact>) -> List<&2,String>:
  match artifacts:
    case Nil{}: Nil{}
    case Con{Artifact{name, path}, rest}: Con{name, artifact_names(rest)}

def names_text(names: List<&2,String>) -> String:
  match names:
    case Nil{}: ""
    case +name <> rest: name ++ "\n" ++ names_text(rest)

def pick(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case +a <> rest: a

def run(text: String) -> IO(Unit):
  IO.print(names_text(artifact_names(artifact_rows(Tx.split_lines(text)))))

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(pick(args))
