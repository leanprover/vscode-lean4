import Lake
open Lake DSL

package test {
  -- add configuration options here
}


lean_lib Test {
  -- add library configuration options here
}

@[default_target]
lean_exe test {
  root := `Main
}
