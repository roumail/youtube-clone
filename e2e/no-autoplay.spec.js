// Rule: nothing ever starts by itself, including at the end of a video.
import { test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, playerState, PIN } from './support.js';

test.fixme('at the end of a video, nothing else starts', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" (3 s) and "medium" are stored, and "tiny" is playing', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny', 'medium');
    await openVideo(page, 'tiny');
    await page.getByTestId('play-button').click();
    await enterPin(page, PIN);
    await expectPlaying(page);
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

test.fixme('the video element has no autoplay and no native controls', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" is open', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny');
    await openVideo(page, 'tiny');
  });
  await test.step('Then the <video> is locked down against bypassing the PIN', async () => {
    const attrs = await page.getByTestId('player-video').evaluate((v) => ({
      autoplay: v.autoplay,
      controls: v.controls,
      playsInline: v.playsInline,
      disablePictureInPicture: v.disablePictureInPicture,
      disableRemotePlayback: v.disableRemotePlayback,
    }));
    expect(attrs).toEqual({
      autoplay: false, controls: false, playsInline: true, disablePictureInPicture: true, disableRemotePlayback: true,
    });
  });
});
