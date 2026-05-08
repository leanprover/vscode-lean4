-- Fixture used by the "Messages" / "All Messages" InfoView tests.
--   line 5: `rfl` on a false equation → type-mismatch error
--   line 7: `#check` always emits an info message

example : 1 + 1 = 3 := by
  rfl

#check (1 + 1 : Nat)
