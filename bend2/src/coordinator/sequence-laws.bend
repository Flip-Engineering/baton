import Base
import ./commands.bend as C
import ./sequence.bend as Sequence

law sequence_lower_is_exclusive:
  for text: String
  {C.sequence_predicate(">",C.IndexExact{text}) == "m.seq>CAST(" ++ C.q(text) ++ " AS INTEGER)" : String}

def sequence_lower_is_exclusive(text):
  {==}

law sequence_upper_is_inclusive:
  for text: String
  {C.sequence_predicate("<=",C.IndexExact{text}) == "m.seq<=CAST(" ++ C.q(text) ++ " AS INTEGER)" : String}

def sequence_upper_is_inclusive(text):
  {==}

law absent_sequence_bound_is_unbounded:
  for operator: String
  {C.sequence_predicate(operator,C.IndexAny{}) == "1" : String}

def absent_sequence_bound_is_unbounded(operator):
  {==}

law sequence_selection_conjoins_filters_bounds_and_order:
  for r: C.IndexText
  for s: C.IndexText
  for k: C.IndexText
  for state: String
  for after: C.IndexText
  for through: C.IndexText
  {C.message_range_sql(r,s,k,state,after,through) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ C.message_index_row() ++ " AS item FROM messages m WHERE " ++ C.index_filter("m.recipient",r) ++ " AND " ++ C.index_filter("m.sender",s) ++ " AND " ++ C.index_filter("m.kind",k) ++ " AND " ++ C.index_state_sql(state) ++ " AND " ++ C.sequence_predicate(">",after) ++ " AND " ++ C.sequence_predicate("<=",through) ++ " ORDER BY m.seq);" : String}

def sequence_selection_conjoins_filters_bounds_and_order(r,s,k,state,after,through):
  {==}

law sequence_command_uses_the_range_selection:
  for r: C.IndexText
  for s: C.IndexText
  for k: C.IndexText
  for state: String
  for after: C.IndexText
  for through: C.IndexText
  {C.sql(C.MessageRange{r,s,k,state,after,through}) == C.message_range_sql(r,s,k,state,after,through) : String}

def sequence_command_uses_the_range_selection(r,s,k,state,after,through):
  {==}

law sequence_parser_preserves_bounds_and_receipt_filter:
  {C.parse(["pending","--through-seq","9007199254740993","--index","--state","all","--after-seq","4294967296"]) == C.MessageRange{C.IndexAny{},C.IndexAny{},C.IndexAny{},"all",C.IndexExact{"4294967296"},C.IndexExact{"9007199254740993"}} : C.Command}

def sequence_parser_preserves_bounds_and_receipt_filter():
  {==}

law sequence_inbox_preserves_literal_filter_values:
  {C.parse(["inbox","--after-seq","--index","--sender","--through-seq","--after-seq","0"]) == C.MessageRange{C.IndexExact{"--after-seq"},C.IndexExact{"--through-seq"},C.IndexAny{},"pending",C.IndexExact{"0"},C.IndexAny{}} : C.Command}

def sequence_inbox_preserves_literal_filter_values():
  {==}

law sequence_repeated_bound_refuses:
  {C.parse(["pending","--index","--after-seq","1","--after-seq","2"]) == C.Invalid{} : C.Command}

def sequence_repeated_bound_refuses():
  {==}

law sequence_reversed_bounds_refuse:
  {C.parse(["pending","--index","--after-seq","10","--through-seq","9"]) == C.Invalid{} : C.Command}

def sequence_reversed_bounds_refuse():
  {==}

law sequence_equal_bounds_remain_an_empty_selection:
  {C.parse(["pending","--index","--after-seq","9","--through-seq","9"]) == C.MessageRange{C.IndexAny{},C.IndexAny{},C.IndexAny{},"pending",C.IndexExact{"9"},C.IndexExact{"9"}} : C.Command}

def sequence_equal_bounds_remain_an_empty_selection():
  {==}

law sequence_requires_index:
  {C.parse(["pending","--pretty","--after-seq","0"]) == C.Invalid{} : C.Command}

def sequence_requires_index():
  {==}

law sequence_missing_value_refuses:
  {C.parse(["pending","--index","--through-seq"]) == C.Invalid{} : C.Command}

def sequence_missing_value_refuses():
  {==}

law sequence_digits_accept_complete_decimal_syntax:
  {Sequence.digits("1234567890123456789012345678901234567890") == True{} : Bool}

def sequence_digits_accept_complete_decimal_syntax():
  {==}

law sequence_digits_reject_a_nondigit_suffix:
  {Sequence.digits("1234567890123456789012345678901234567890x") == False{} : Bool}

def sequence_digits_reject_a_nondigit_suffix():
  {==}

law sequence_complete_decimal_must_fit_the_database_domain:
  {Sequence.valid("1234567890123456789012345678901234567890") == False{} : Bool}

def sequence_complete_decimal_must_fit_the_database_domain():
  {==}

law sequence_zero_is_valid:
  {Sequence.valid("0") == True{} : Bool}

def sequence_zero_is_valid():
  {==}

law sequence_decimal_order_compares_different_widths:
  {Sequence.decimal_le("99","100") == True{} : Bool}

def sequence_decimal_order_compares_different_widths():
  {==}

law sequence_decimal_order_rejects_the_wider_operand:
  {Sequence.decimal_le("100","99") == False{} : Bool}

def sequence_decimal_order_rejects_the_wider_operand():
  {==}

law sequence_maximum_is_valid:
  {Sequence.valid("9223372036854775807") == True{} : Bool}

def sequence_maximum_is_valid():
  {==}

law sequence_overflow_is_invalid:
  {Sequence.valid("9223372036854775808") == False{} : Bool}

def sequence_overflow_is_invalid():
  {==}

law sequence_leading_zero_is_invalid:
  {Sequence.valid("01") == False{} : Bool}

def sequence_leading_zero_is_invalid():
  {==}

law sequence_signed_value_is_invalid:
  {Sequence.valid("-1") == False{} : Bool}

def sequence_signed_value_is_invalid():
  {==}

law sequence_empty_value_is_invalid:
  {Sequence.valid("") == False{} : Bool}

def sequence_empty_value_is_invalid():
  {==}

law sequence_trailing_newline_is_invalid:
  {Sequence.valid("1\n") == False{} : Bool}

def sequence_trailing_newline_is_invalid():
  {==}
