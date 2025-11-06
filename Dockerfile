FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Build deps & delegates
RUN apt-get update && apt-get install -y \
  build-essential pkg-config curl ca-certificates wget git \
  libjpeg-dev libpng-dev libtiff-dev libwebp-dev \
  libraw-dev dcraw \
  librsvg2-dev librsvg2-bin \
  libheif-dev libde265-dev \
  libopenexr-dev \
  libopenjp2-7-dev \
  liblcms2-dev \
  libfontconfig1-dev libfreetype6-dev libpango1.0-dev \
  libxml2-dev libltdl-dev libfftw3-dev \
  ghostscript gsfonts \
  nodejs npm && rm -rf /var/lib/apt/lists/*

# Build ImageMagick from source with broad delegate support
WORKDIR /tmp
RUN wget https://imagemagick.org/archive/ImageMagick.tar.gz \
  && tar xzf ImageMagick.tar.gz \
  && cd ImageMagick-* \
  && ./configure \
     --with-modules \
     --enable-hdri \
     --with-jpeg=yes --with-png=yes --with-tiff=yes --with-webp=yes \
     --with-rsvg=yes --with-raw=yes --with-heic=yes --with-openexr=yes \
     --with-openjp2=yes --with-fontconfig=yes --with-freetype=yes \
     --with-pango=yes \
  && make -j$(nproc) && make install && ldconfig \
  && cd /tmp && rm -rf ImageMagick*

# App
WORKDIR /app
COPY package.json index.js ./
RUN npm install --omit=dev
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "require('http').get('http://localhost:8080/health', r=>process.exit(r.statusCode===200?0:1))"
CMD ["node","index.js"]


