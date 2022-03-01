import Lake

def getLeanVersion :=
    Lean.versionString

#eval s!"Lean Version: {getLeanVersion}"

#eval s!"Lake Version: {Lake.versionString}"
