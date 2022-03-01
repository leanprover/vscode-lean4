
/-- Return the the product of all positive integers less than or equal to the
input value -/
def factorial x :=
  match x with
  | 0   => 1
  | n + 1 => (n + 1) * factorial n

/-- Return the sum of all the numbers in the given list. -/
def sum (x : List Nat) : Nat :=
  match x with
  | [] => 0
  | a :: as => a + sum (as)

#eval factorial 7

#eval Lean.versionString

#eval IO.appPath 
