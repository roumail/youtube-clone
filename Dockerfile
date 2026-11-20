# Prepare videos on any machine with Docker: see tools/README.md.
FROM mwader/static-ffmpeg:9.0.2-1@sha256:f5d100184884eb3e82b0eb14bb5ebf98da99826ac824989720297fb9ef21c822 AS ffmpeg

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS packager
RUN apk add --no-cache bash curl
COPY tools/get-packager.sh /tools/
RUN /tools/get-packager.sh

FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS kidsvideo
COPY tools/kidsvideo /src
RUN cd /src && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /kidsvideo .

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
RUN apk upgrade --no-cache && apk add --no-cache bash perl tar
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY tools/run_prepare.sh tools/get-packager.sh /tools/
COPY --from=packager /tools/bin/packager /tools/bin/packager
COPY --from=kidsvideo /kidsvideo /tools/bin/kidsvideo
ENV KIDS_LIBRARY=/out
ENTRYPOINT ["/tools/run_prepare.sh"]
