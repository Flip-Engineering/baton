# Operative classification admission for native runtime observation facts and
# their expansions (docs/bend2/semantic-context-spec.md, Results and Runtime
# contract). Each law sits beside the function it binds; the coordinator entry
# imports this module through the shared laws handoff, and the isolated
# development entry is bend2/tests/runtime/observations-laws.bend.

import Base

# The four fact classifications of the result schema. The runtime path
# observes; the other families belong to their own producers.
type FactClass is Data:
  Observed{}
  StaticPossible{}
  Checked{}
  Declared{}

def class_tag(cls: FactClass) -> String:
  match cls:
    case Observed{}: "observed"
    case StaticPossible{}: "static-possible"
    case Checked{}: "checked"
    case Declared{}: "declared"

# A runtime fact admits its observed classification and refuses the analysis
# families.
def fact_class_admitted(cls: FactClass) -> Bool:
  match cls:
    case Observed{}: True{}
    case StaticPossible{}: False{}
    case Checked{}: False{}
    case Declared{}: False{}

# Ref expansion preserves the classification the referenced fact already
# carries. A proposed class is admitted only when it equals the original; no
# expansion upgrades a fact's classification.
def expansion_admitted(original: FactClass, proposed: FactClass) -> Bool:
  String.eq(class_tag(original), class_tag(proposed))

# A value rendering is complete only when no preview stands in for the value
# and the full property expansion reported no overflow. Any preview is an
# incomplete rendering regardless of its own flags; thresholds observed in
# fixtures are fixture facts, not rules.
def observed_value_complete(hasPreview: Bool, expansionOverflow: Bool) -> Bool:
  Bool.and(Bool.not(hasPreview), Bool.not(expansionOverflow))

law runtime_fact_admits_only_the_observed_classification:
  {Bool.and(Bool.and(fact_class_admitted(Observed{}), Bool.not(fact_class_admitted(StaticPossible{}))), Bool.and(Bool.not(fact_class_admitted(Checked{})), Bool.not(fact_class_admitted(Declared{})))) == True{} : Bool}

def runtime_fact_admits_only_the_observed_classification():
  {==}

law class_tags_are_the_four_fixed_names:
  for cls: FactClass
  {Bool.or(Bool.or(String.eq(class_tag(cls), "observed"), Bool.or(String.eq(class_tag(cls), "static-possible"), String.eq(class_tag(cls), "checked"))), String.eq(class_tag(cls), "declared")) == True{} : Bool}

def class_tags_are_the_four_fixed_names(cls):
  {==}

law expansion_admits_each_class_at_itself:
  for cls: FactClass
  {expansion_admitted(cls, cls) == True{} : Bool}

def expansion_admits_each_class_at_itself(cls):
  {==}

law observed_expansion_refuses_every_other_classification:
  {Bool.and(Bool.and(Bool.not(expansion_admitted(Observed{}, StaticPossible{})), Bool.not(expansion_admitted(Observed{}, Checked{}))), Bool.not(expansion_admitted(Observed{}, Declared{}))) == True{} : Bool}

def observed_expansion_refuses_every_other_classification():
  {==}

law observed_value_completeness_follows_the_conservative_rule:
  for hasPreview: Bool
  for overflow: Bool
  {observed_value_complete(hasPreview, overflow) == Bool.and(Bool.not(hasPreview), Bool.not(overflow)) : Bool}

def observed_value_completeness_follows_the_conservative_rule(hasPreview, overflow):
  {==}

law a_preview_is_incomplete_regardless_of_its_flags:
  for overflow: Bool
  {observed_value_complete(True{}, overflow) == False{} : Bool}

def a_preview_is_incomplete_regardless_of_its_flags(overflow):
  {==}
