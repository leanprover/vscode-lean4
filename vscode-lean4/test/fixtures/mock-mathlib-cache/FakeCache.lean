-- Test fixture for `lean4.project.fetchCache` and friends. Writes a sentinel
-- file recording the args it was invoked with, so the test can assert that
-- the production code actually invoked `lake exe cache` (rather than skipping
-- it and surfacing a stale "fetched successfully" prompt). Each test
-- scaffolds a fresh tmpdir so a sentinel from a prior test can't leak in.
def main (args : List String) : IO UInt32 := do
  IO.FS.writeFile "cache-invoked.txt" (String.intercalate "\n" args)
  pure 0
