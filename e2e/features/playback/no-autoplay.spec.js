// Feature: No autoplay — a video played alone never starts another one.
// (Only a playlist plays its next video: see playlist.spec.js.)
import { test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState } from '../../support.js';

test.describe('Feature: No autoplay', () => {
  test('Scenario: at the end of a video, nothing else starts', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "tiny" (3 s) and "medium" are stored, and "tiny" is playing', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
    await test.step('When "tiny" reaches its end', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'ended');
    });
    await test.step('Then it stays on "tiny", stopped, with no other video loaded', async () => {
      await expectNotPlaying(page);
      await expect(page).toHaveURL(/#\/player\//);
      expect(decodeURIComponent(page.url())).not.toContain('medium');
    });
  });
});
