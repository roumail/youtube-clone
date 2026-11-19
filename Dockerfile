# Prepare videos on any machine with Docker: see tools/README.md.
FROM mwader/static-ffmpeg:9.0.2-1@sha256:f5d100184884eb3e82b0eb14bb5ebf98da99826ac824989720297fb9ef21c822 AS ffmpeg

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS packager
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates
COPY tools/get-packager.sh /tools/
RUN /tools/get-packager.sh

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY tools/run_prepare.sh tools/prepare.sh tools/pack.sh tools/get-packager.sh /tools/
COPY --from=packager /tools/bin/packager /tools/bin/packager
ENV KIDS_LIBRARY=/out
ENTRYPOINT ["/tools/run_prepare.sh"]
