import Base

law bool_cmp_self:
  for +b: Bool
  {Bool.cmp(b, b) == EQ{} : Cmp}

def bool_cmp_self(b):
  match b:
    case True{}: {==}
    case False{}: {==}

law word_cmp_self:
  for n: Nat
  for +word: Word(n)
  {Word.cmp(n, word, word) == EQ{} : Cmp}

def word_cmp_self(n, word):
  match n:
    case 0n: {==}
    case 1n+p:
      match word:
        case WCon{+head, +tail}:
          %bool_cmp_self(head) : {Word.cmp.fin(head, head, Word.cmp(p, tail, tail)) == _ : Cmp}
          %word_cmp_self(p, tail) : {Word.cmp.fin(head, head, Word.cmp(p, tail, tail)) == Word.cmp.fin(head, head, _) : Cmp}
          {==}

law char_cmp_self:
  for +c: Char
  {Char.cmp(c, c) == ((c, c), EQ{}) : (Char & Char) & Cmp}

def char_cmp_self(c):
  match c:
    case Chr{+code}:
      match code:
        case U32{+word}:
          %word_cmp_self(32n, word) : {((Chr{U32{word}}, Chr{U32{word}}), Word.cmp(32n, word, word)) == ((Chr{U32{word}}, Chr{U32{word}}), _) : (Char & Char) & Cmp}
          {==}

law string_cmp_self:
  for +s: String
  {String.cmp(s, s) == ((s, s), EQ{}) : (String & String) & Cmp}

def string_cmp_self(s):
  match s:
    case SNil{}: {==}
    case SCon{+head, +tail}:
      %string_cmp_self(tail) : {String.cmp(s, s) == String.cmp.rec(head, head, _) : (String & String) & Cmp}
      %char_cmp_self(head) : {String.cmp(s, s) == String.cmp.fin(tail, tail, _) : (String & String) & Cmp}
      {==}

law string_eq_self:
  for +s: String
  {String.eq(s, s) == True{} : Bool}

def string_eq_self(s):
  %string_cmp_self(s) : {String.eq.fin(String.cmp(s, s)) == String.eq.fin(_) : Bool}
  {==}


law append_associative:
  for +prefix: String
  for +left: String
  for +right: String
  {(prefix ++ left) ++ right == prefix ++ (left ++ right) : String}

def append_associative(prefix,left,right):
  match prefix:
    case SNil{}: {==}
    case SCon{+head,+tail}:
      %append_associative(tail,left,right) : {SCon{head,(tail ++ left) ++ right} == SCon{head,_} : String}
      {==}

law prefix_a_before_b:
  for +prefix: String
  for +left: String
  for +right: String
  {String.cmp(prefix ++ SCon{'a',left},prefix ++ SCon{'b',right}) == ((prefix ++ SCon{'a',left},prefix ++ SCon{'b',right}),LT{}) : (String & String) & Cmp}

def prefix_a_before_b(prefix,left,right):
  match prefix:
    case SNil{}: {==}
    case SCon{+head,+tail}:
      %prefix_a_before_b(tail,left,right) : {String.cmp(prefix ++ SCon{'a',left},prefix ++ SCon{'b',right}) == String.cmp.rec(head,head,_) : (String & String) & Cmp}
      %char_cmp_self(head) : {String.cmp(prefix ++ SCon{'a',left},prefix ++ SCon{'b',right}) == String.cmp.fin(tail ++ SCon{'a',left},tail ++ SCon{'b',right},_) : (String & String) & Cmp}
      {==}

law prefix_a_differs_from_b:
  for +prefix: String
  for +left: String
  for +right: String
  {Bool.not(String.eq(prefix ++ SCon{'a',left},prefix ++ SCon{'b',right})) == True{} : Bool}

def prefix_a_differs_from_b(prefix,left,right):
  %prefix_a_before_b(prefix,left,right) : {Bool.not(String.eq(prefix ++ SCon{'a',left},prefix ++ SCon{'b',right})) == Bool.not(String.eq.fin(_)) : Bool}
  {==}
