import Test.Version

def main : IO Unit :=
  IO.println s!"Hello: {getLeanVersion}"

#eval main

#eval IO.appPath