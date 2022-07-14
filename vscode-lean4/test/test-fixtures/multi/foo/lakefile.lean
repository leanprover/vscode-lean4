import Lake
open Lake DSL

package foo {
  -- add configuration options here
}


lean_lib Foo {
  -- add library configuration options here
}

@[defaultTarget]
lean_exe foo {
  root := `Main
}
