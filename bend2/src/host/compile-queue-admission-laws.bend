# Laws for the tie order of equal-priority compile queue requests (#1407). A ticket is ahead of
# mine when its priority is greater, or equal with an older token ("<started_ns>-<pid>"), compared
# as numbers: started_ns, then pid, then the token text. A token that does not parse is never ahead
# by age.
# Admission blocks behind such a ticket only while that ticket's request is eligible, which
# admission_waiter_fits decides; an older request that is not eligible does not block.
import Base
import ./compile-queue.bend as Q

law a_higher_priority_ticket_is_ahead:
  {Q.admission_ahead(9,"1793353900000000000-5",0,"1793353800000000000-4") == True{} : Bool}

def a_higher_priority_ticket_is_ahead():
  {==}

law a_higher_priority_older_ticket_is_ahead:
  {Q.admission_ahead(9,"1793353700000000000-3",0,"1793353800000000000-4") == True{} : Bool}

def a_higher_priority_older_ticket_is_ahead():
  {==}

law an_older_equal_priority_ticket_is_ahead:
  {Q.admission_ahead(1,"1793353451698186593-1716070",1,"1793354324388527269-2337307") == True{} : Bool}

def an_older_equal_priority_ticket_is_ahead():
  {==}

law a_newer_equal_priority_ticket_is_not_ahead:
  {Q.admission_ahead(1,"1793354324388527269-2337307",1,"1793353451698186593-1716070") == False{} : Bool}

def a_newer_equal_priority_ticket_is_not_ahead():
  {==}

law the_same_ticket_is_not_ahead_of_itself:
  {Q.admission_ahead(1,"1793353451698186593-1716070",1,"1793353451698186593-1716070") == False{} : Bool}

def the_same_ticket_is_not_ahead_of_itself():
  {==}

law a_lower_priority_ticket_is_not_ahead:
  {Q.admission_ahead(0,"1793353451698186593-1716070",1,"1793354324388527269-2337307") == False{} : Bool}

def a_lower_priority_ticket_is_not_ahead():
  {==}

law an_equal_priority_ticket_without_a_token_is_not_ahead:
  {Q.admission_ahead(1,"",1,"1793354324388527269-2337307") == False{} : Bool}

def an_equal_priority_ticket_without_a_token_is_not_ahead():
  {==}

law the_same_start_time_is_ordered_by_pid_text:
  {Q.admission_ahead(1,"1793353451698186593-1716070",1,"1793353451698186593-1716071") == True{} : Bool}

def the_same_start_time_is_ordered_by_pid_text():
  {==}

law a_shorter_timestamp_is_numerically_older_though_it_sorts_later_as_text:
  {Q.admission_ahead(1,"999999999999999999-1",1,"1793354324388527269-2337307") == True{} : Bool}

def a_shorter_timestamp_is_numerically_older_though_it_sorts_later_as_text():
  {==}

law a_longer_timestamp_is_numerically_newer_though_it_sorts_earlier_as_text:
  {Q.admission_ahead(1,"100000000000000000000-1",1,"1793354324388527269-2337307") == False{} : Bool}

def a_longer_timestamp_is_numerically_newer_though_it_sorts_earlier_as_text():
  {==}

law equal_timestamps_are_ordered_by_pid_as_a_number:
  {Q.admission_ahead(1,"1793353451698186593-9",1,"1793353451698186593-10") == True{} : Bool}

def equal_timestamps_are_ordered_by_pid_as_a_number():
  {==}

law the_larger_pid_at_an_equal_timestamp_is_not_ahead:
  {Q.admission_ahead(1,"1793353451698186593-10",1,"1793353451698186593-9") == False{} : Bool}

def the_larger_pid_at_an_equal_timestamp_is_not_ahead():
  {==}

law equal_numbers_are_ordered_by_token_text:
  {Q.admission_ahead(1,"05-9",1,"5-9") == True{} : Bool}

def equal_numbers_are_ordered_by_token_text():
  {==}

law the_later_token_text_of_equal_numbers_is_not_ahead:
  {Q.admission_ahead(1,"5-9",1,"05-9") == False{} : Bool}

def the_later_token_text_of_equal_numbers_is_not_ahead():
  {==}


law a_token_without_a_pid_is_not_ahead:
  {Q.admission_ahead(1,"1-",1,"1793354324388527269-2337307") == False{} : Bool}

def a_token_without_a_pid_is_not_ahead():
  {==}

law a_token_without_a_timestamp_is_not_ahead:
  {Q.admission_ahead(1,"-1",1,"1793354324388527269-2337307") == False{} : Bool}

def a_token_without_a_timestamp_is_not_ahead():
  {==}

law a_token_with_a_letter_is_not_ahead:
  {Q.admission_ahead(1,"1a-2",1,"1793354324388527269-2337307") == False{} : Bool}

def a_token_with_a_letter_is_not_ahead():
  {==}

law a_token_with_three_parts_is_not_ahead:
  {Q.admission_ahead(1,"1-2-3",1,"1793354324388527269-2337307") == False{} : Bool}

def a_token_with_three_parts_is_not_ahead():
  {==}

law a_token_without_a_hyphen_is_not_ahead:
  {Q.admission_ahead(1,"12",1,"1793354324388527269-2337307") == False{} : Bool}

def a_token_without_a_hyphen_is_not_ahead():
  {==}

law my_own_malformed_token_is_not_older_than_any_ticket:
  {Q.admission_ahead(1,"1-1",1,"mine") == False{} : Bool}

def my_own_malformed_token_is_not_older_than_any_ticket():
  {==}

law a_higher_priority_ticket_with_a_malformed_token_is_still_ahead:
  {Q.admission_ahead(9,"garbage",1,"1793354324388527269-2337307") == True{} : Bool}

def a_higher_priority_ticket_with_a_malformed_token_is_still_ahead():
  {==}
