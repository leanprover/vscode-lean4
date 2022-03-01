import Test
import Lean
import Lean.Expr

def main : IO Unit :=
  IO.println s!"Hello, {hello}!"

#eval Lean.versionString

#eval main

#eval IO.appPath