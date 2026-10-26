import Base

# Two U32 words retain unsigned 64-bit observations and protocol hashes.
# The pinned native runtime represents Nat with 48 bits.
type Wide64 is Data:
  Wide64{high: U32, low: U32}

def zero() -> Wide64:
  Wide64{0,0}

def from_u32(value: U32) -> Wide64:
  Wide64{0,value}

def add(left: Wide64, right: Wide64) -> Wide64:
  match left right:
    case Wide64{ah,+al} Wide64{bh,bl}:
      +low = U32.add(al,bl)
      Wide64{U32.add(U32.add(ah,bh),Bool.to_u32(U32.is_lt(low,al))),low}

def less(left: Wide64, right: Wide64) -> Bool:
  match left right:
    case Wide64{+ah,al} Wide64{+bh,bl}: Bool.or(U32.is_lt(ah,bh),Bool.and(U32.is_eq(ah,bh),U32.is_lt(al,bl)))

def equal(left: Wide64, right: Wide64) -> Bool:
  match left right:
    case Wide64{ah,al} Wide64{bh,bl}: Bool.and(U32.is_eq(ah,bh),U32.is_eq(al,bl))

def sub(left: Wide64, right: Wide64) -> Wide64:
  match left right:
    case Wide64{ah,+al} Wide64{bh,+bl}: Wide64{U32.sub(U32.sub(ah,bh),Bool.to_u32(U32.is_lt(al,bl))),U32.sub(al,bl)}

def scale(value: Wide64, +factor: U32) -> Wide64:
  match value:
    case Wide64{high,+low}:
      +first = U32.mul(U32.mod(low,65536),factor)
      +second = U32.add(U32.mul(U32.div(low,65536),factor),U32.div(first,65536))
      Wide64{U32.add(U32.mul(high,factor),U32.div(second,65536)),U32.add(U32.mul(second,65536),U32.mod(first,65536))}

def parse_go(text: String, value: Wide64) -> Wide64:
  match text:
    case SNil{}: value
    case SCon{+char,rest}:
      Bool.pick(Wide64,Char.is_digit(char),parse_go(rest,add(scale(value,10),from_u32(U32.sub(Char.to_u32(char),48)))),zero())

def parse(text: String) -> Wide64:
  parse_go(text,zero())

def divide_ten(value: Wide64) -> Wide64 & U32:
  match value:
    case Wide64{+high,+low}:
      +a = U32.div(high,65536)
      +b = U32.add(U32.mul(U32.mod(a,10),65536),U32.mod(high,65536))
      +c = U32.add(U32.mul(U32.mod(b,10),65536),U32.div(low,65536))
      +d = U32.add(U32.mul(U32.mod(c,10),65536),U32.mod(low,65536))
      (Wide64{U32.add(U32.mul(U32.div(a,10),65536),U32.div(b,10)),U32.add(U32.mul(U32.div(c,10),65536),U32.div(d,10))},U32.mod(d,10))

@unsafe
def show_go(+again_show_step: (@pair: Wide64 & U32 -> @acc: String -> String), +value: Wide64, +acc: String) -> String:
  Bool.pick(String,equal(value,zero()),acc,again_show_step(divide_ten(value),acc))

@unsafe
def show_step(pair: Wide64 & U32, acc: String) -> String:
  match pair:
    case (value,digit): show_go(show_step, value,U32.show(digit) ++ acc)

def show(+value: Wide64) -> String:
  Bool.pick(String,equal(value,zero()),"0",show_go(show_step, value,""))

@unsafe
def hex_word(+value: U32, +count: U32, +acc: String) -> String:
  Bool.pick(String,U32.is_eq(count,0),acc,hex_word(U32.div(value,16),U32.sub(count,1),String.take(String.drop("0123456789abcdef",U32.to_nat(U32.mod(value,16))),1n) ++ acc))

def hex(value: Wide64) -> String:
  match value:
    case Wide64{high,low}: hex_word(high,8,"") ++ hex_word(low,8,"")

def fnv_step(value: Wide64, byte: U32) -> Wide64:
  match value:
    case Wide64{high,low}:
      +mixed = U32.xor(low,byte)
      +first = U32.mul(U32.mod(mixed,65536),435)
      +second = U32.add(U32.mul(U32.div(mixed,65536),435),U32.div(first,65536))
      Wide64{U32.add(U32.add(U32.mul(high,435),U32.mul(mixed,256)),U32.div(second,65536)),U32.add(U32.mul(second,65536),U32.mod(first,65536))}

def elapsed_lt(+now: String, +then: String, interval: U32) -> Bool:
  +current = parse(now)
  +previous = parse(then)
  Bool.and(Bool.not(equal(previous,zero())),Bool.and(Bool.not(less(current,previous)),less(sub(current,previous),from_u32(interval))))

def at_or_after(now: String, then: String) -> Bool:
  Bool.not(less(parse(now),parse(then)))

def after(now: String, nanoseconds: U32) -> String:
  show(add(parse(now),from_u32(nanoseconds)))
