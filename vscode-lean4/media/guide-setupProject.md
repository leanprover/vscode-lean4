## Project Creation
If you want to create a new project, click on one of the following:
- [Create a new library project](command:lean4.project.createLibraryProject)  
  Library projects can be used by other Lean 4 projects.
- [Create a new math formalization project](command:lean4.project.createMathlibProject)  
  Math formalization projects are library projects that depend on [mathlib](https://github.com/leanprover-community/mathlib4), the math library of Lean 4.
- [Create a new program project](command:lean4.project.createProgramProject)  
  Program projects allow compiling Lean code to executable programs.

If you want to open an existing project, click on one of the following:
- [Download an existing project](command:lean4.project.clone)
- [Open an existing local project](command:lean4.project.open)

After creating or downloading a project, you can open it in the future by clicking the ∀-symbol in the top right, choosing 'Open Project…' > 'Open Local Project…' and selecting the project you created.

## Complex Project Setups
Using its build system and package manager Lake, Lean 4 supports project setups that are more complex than the ones above. You can find out more about Lake in the [Lean 4 GitHub repository](https://github.com/leanprover/lean4/blob/master/src/lake/README.md).
