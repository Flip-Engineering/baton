import Base

type Tree is Data:
  Leaf{value: U32}
  Branch{left: Tree, right: Tree}

type Copies<-A: Data> is Data:
  End{}
  Copy{value: A, rest: Copies<A>}

def share(-A: Data, +value: A) -> Copies<A>:
  Copy{value, Copy{value, End{}}}

def duplicate(-A: Data, value: A) -> Copies<A>:
  share(A, value)

def tree_sum(tree: Tree) -> U32:
  match tree:
    case Leaf{value}: value
    case Branch{left, right}: U32.add(tree_sum(left), tree_sum(right))

def list_sum(xs: List<&2, U32>) -> U32:
  match xs:
    case Nil{}: 0
    case +x <> rest: U32.add(x, list_sum(rest))

def list_pair(pair: Copies<List<&2, U32>>) -> U32:
  match pair:
    case End{}: 0
    case Copy{value, rest}: U32.add(list_sum(value), list_pair(rest))

def tree_pair(pair: Copies<Tree>) -> U32:
  match pair:
    case End{}: 0
    case Copy{value, rest}: U32.add(tree_sum(value), tree_pair(rest))

def reverse_copies(-A: Data, copies: Copies<A>, acc: Copies<A>) -> Copies<A>:
  match copies:
    case End{}: acc
    case Copy{value, rest}: reverse_copies(A, rest, Copy{value, acc})

def via(-A: Data, copies: Copies<A>) -> Copies<A>:
  reverse_copies(A, copies, End{})

def inspect(xs: List<&2, U32>, tree: Tree) -> U32:
  U32.add(list_pair(duplicate(List<&2, U32>, xs)), tree_pair(via(Tree, duplicate(Tree, tree))))

def make_tree(n: Nat) -> Tree:
  match n:
    case 0n: Leaf{7}
    case 1n+p: Branch{Leaf{3}, make_tree(p)}

def main() -> U32:
  inspect([1, 2, 3], make_tree(32n))
