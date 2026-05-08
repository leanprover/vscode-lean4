-- Fixture for the InfoView go-to-definition test. In the goal `foo = 42`,
-- ctrl-click on `foo` should jump the editor to the `def foo` on line 3.

def foo : Nat := 42

example : foo = 42 := by
  sorry
