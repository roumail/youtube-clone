// M0 spike page in the pinned Chrome: picked files -> local: scheme -> Shaka
// offline storage -> playback. The iPad run of the same page is manual.
import { test, expect, fixtureFiles, mediaSessionAction } from '../support.js';

const result = (page, id) => page.getByTestId(`check-${id}`);

test.beforeEach(async ({ page }) => {
  await page.goto('./spike/');
  await expect(result(page, 'shaka')).toHaveAttribute('data-result', 'pass');
});

test('spike: picked fixture files are stored via the local: scheme and play back', async ({ page }) => {
  await test.step('Given the spike page is loaded with Shaka supported', async () => {
    await expect(result(page, 'mse')).toHaveAttribute('data-result', 'pass');
  });
  await test.step('When I pick the 4 files of "tiny"', async () => {
    await page.getByTestId('spike-files').setInputFiles(fixtureFiles('tiny'));
  });
  await test.step('Then the store check passes and "tiny" is listed', async () => {
    await expect(result(page, 'store')).toHaveAttribute('data-result', 'pass');
    await expect(page.getByTestId('spike-item')).toHaveCount(1);
    await expect(page.getByTestId('spike-item')).toContainText('tiny');
  });
  await test.step('When I tap Play', async () => {
    await page.getByTestId('spike-play').click();
  });
  await test.step('Then the playback check passes', async () => {
    await expect(result(page, 'play')).toHaveAttribute('data-result', 'pass');
  });
  await test.step('And the codec probe reports the stored codecs', async () => {
    await expect(result(page, 'codec-probe')).toHaveAttribute('data-result', 'info');
    await expect(result(page, 'codec-probe')).toContainText('avc1.');
    await expect(result(page, 'codec-probe')).toContainText('mp4a.40.2');
    await expect(result(page, 'codec-probe')).toContainText('SHAKA: media-source video+audio: supported=true');
  });
});

test('spike: a pick with a missing file is rejected', async ({ page }) => {
  await test.step('When I pick "broken-missing-audio" (no audio.mp4)', async () => {
    await page.getByTestId('spike-files').setInputFiles(fixtureFiles('broken-missing-audio').filter((f) => !f.endsWith('audio.mp4')));
  });
  await test.step('Then the store check fails and nothing is listed', async () => {
    await expect(result(page, 'store')).toHaveAttribute('data-result', 'fail');
    await expect(result(page, 'store')).toContainText('audio.mp4');
    await expect(page.getByTestId('spike-item')).toHaveCount(0);
  });
});

test('spike: an OS "play" command is received and ignored', async ({ page }) => {
  await test.step('Given nothing is playing', async () => {
    await expect(page.getByTestId('spike-video')).toHaveJSProperty('paused', true);
  });
  await test.step('When the OS sends a Media Session "play"', async () => {
    await mediaSessionAction(page, 'play');
  });
  await test.step('Then the check passes and the video stays paused', async () => {
    await expect(result(page, 'media-session')).toHaveAttribute('data-result', 'pass');
    await expect(page.getByTestId('spike-video')).toHaveJSProperty('paused', true);
  });
});

test('spike: SDR video still stores and plays on a wide-gamut (P3) screen', async ({ page }) => {
  await test.step('Given the screen reports a P3 colour gamut (support.js emulates this for every test)', async () => {
    expect(await page.evaluate(() => matchMedia('(color-gamut: p3)').matches)).toBe(true);
  });
  await test.step('When I pick the 4 files of "tiny" (manifest marks it SDR / BT.709)', async () => {
    await page.getByTestId('spike-files').setInputFiles(fixtureFiles('tiny'));
  });
  await test.step('Then it is stored with real data, not an empty entry', async () => {
    await expect(result(page, 'store')).toHaveAttribute('data-result', 'pass');
  });
  await test.step('And it plays', async () => {
    await page.getByTestId('spike-play').click();
    await expect(result(page, 'play')).toHaveAttribute('data-result', 'pass');
  });
});

test('spike: an episode-like video (1080p High, BT.709, Chinese + English audio) stores English and plays', async ({ page }) => {
  await test.step('When I pick the 4 files of "episode-like"', async () => {
    await page.getByTestId('spike-files').setInputFiles(fixtureFiles('episode-like'));
  });
  await test.step('Then it is stored with the English audio track', async () => {
    await expect(result(page, 'store')).toHaveAttribute('data-result', 'pass');
    await expect(page.getByTestId('spike-log')).toContainText('lang=en');
  });
  await test.step('And it plays', async () => {
    await page.getByTestId('spike-play').click();
    await expect(result(page, 'play')).toHaveAttribute('data-result', 'pass');
  });
});
