package main

// Stage 4 of README.md: specified, not built. Each test names one behaviour
// and skips; building a stage means removing its skips and making them pass.
// Stages 2 and 3 (prepare) are built: prepare_test.go, prepare_batch_test.go.

import "testing"

const notBuilt = "not built yet (README.md)"

// Stage 4: the pinned Shaka Packager (replaces tools/get-packager.sh).

func TestPackagerIsFoundAtPACKAGERElseToolsBin(t *testing.T) { t.Skip(notBuilt) }

func TestPackagerIsDownloadedForThisComputerWhenMissing(t *testing.T) { t.Skip(notBuilt) }

func TestPackagerWithTheWrongChecksumIsRefusedAndNotKept(t *testing.T) { t.Skip(notBuilt) }
