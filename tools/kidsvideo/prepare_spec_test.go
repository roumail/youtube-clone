package main

// Stages 3–4 of README.md: specified, not built. Each test names one behaviour
// and skips; building a stage means removing its skips and making them pass.
// Stage 2 (prepare) is built: prepare_test.go.

import "testing"

const notBuilt = "not built yet (README.md)"

// Stage 3: many videos, titles and series (replaces tools/run_prepare.sh).

func TestPrepareSearchesFoldersForVideoFiles(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareReadsPathsFromStdinWhenGivenNone(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareDestinationComesFromDestElseKidsLibraryElseDotEnv(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareTidiesTheTitleFromTheFileName(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareTitleOptionNamesASingleInput(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareSeriesNamesEpisodesAndFilesThemInTheSeriesFolder(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareSeriesRefusesAFileWithoutSeasonAndEpisode(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareBatchGoesOnAfterAFailureAndEndsWithASummary(t *testing.T) { t.Skip(notBuilt) }

// Stage 4: the pinned Shaka Packager (replaces tools/get-packager.sh).

func TestPackagerIsFoundAtPACKAGERElseToolsBin(t *testing.T) { t.Skip(notBuilt) }

func TestPackagerIsDownloadedForThisComputerWhenMissing(t *testing.T) { t.Skip(notBuilt) }

func TestPackagerWithTheWrongChecksumIsRefusedAndNotKept(t *testing.T) { t.Skip(notBuilt) }
