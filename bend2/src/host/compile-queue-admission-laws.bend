# Laws for the tie order of equal-priority compile queue requests (#1407). A ticket is ahead of
# mine when its priority is greater, or equal with an older token ("<started_ns>-<pid>").
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
