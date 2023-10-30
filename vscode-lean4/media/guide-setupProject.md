## Project Creation
If you want to create a new project, click on one of the following:
- [Create a new standalone project](command:lean4.project.createStandaloneProject)  
  Standalone projects do not depend on any other Lean 4 projects. Dependencies can be added by modifying 'lakefile.lean' in the newly created project as described [here](https://github.com/leanprover/lean4/blob/master/src/lake/README.md#adding-dependencies).
- [Create a new project using Mathlib](command:lean4.project.createMathlibProject)  
  The created project will depend on [Mathlib](https://github.com/leanprover-community/mathlib4), the math library of Lean 4.

If you want to open an existing project, click on one of the following:
- [Download an existing project](command:lean4.project.clone)
- [Open an existing local project](command:lean4.project.open)

After creating or downloading a project, you can open it in the future by clicking the ∀-symbol in the top right, choosing 'Open Project…' > 'Open Local Project…' and selecting the project you created.

## Complex Project Setups
Using its build system and package manager Lake, Lean 4 supports more complex project setups than the ones described above. You can find out more about Lake in the [Lean 4 GitHub repository](https://github.com/leanprover/lean4/blob/master/src/lake/README.md).
