import Test

def main : IO Unit :=
  IO.println s!"Hello, {hello}!"

#eval Lean.versionString