package main

// Stages 2–4 of README.md: specified, not built. Each test names one behaviour
// and skips; building a stage means removing its skips and making them pass.

import "testing"

const notBuilt = "not built yet (README.md)"

// Stage 2: kidsvideo prepare <video> --dest DIR (replaces tools/prepare.sh).

func TestPrepareWritesOneFormat2FileNamedAfterTheTitle(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareUsesTheFirstEnglishAudioTrackElseTheFirst(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareRefusesAVideoWithoutAudio(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareCopiesATrackAlreadyWithinTheSizeTarget(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareReencodesToAtMost720pAnd1200kbitsStereo96k(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareCountsAnUnknownBitrateAsAboveTheTarget(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareReencodesContainersOtherThanMp4M4vMov(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareTakesThePosterFrom10PercentIn640Wide(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareSkipsATitleAlreadyInTheDestination(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareLeavesNothingBehindWhenItFails(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareDryRunSaysCopyOrReencodePerTrackAndWritesNothing(t *testing.T) { t.Skip(notBuilt) }

func TestPrepareShowsProgressOnlyOnATerminal(t *testing.T) { t.Skip(notBuilt) }

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
