FROM php:8.4-cli

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip libzip-dev \
    && docker-php-ext-install pcntl zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

RUN git config --system user.email "indaba@localhost" \
    && git config --system user.name "Indaba" \
    && git config --system --add safe.directory '*' \
    && git config --system init.defaultBranch main

ENV COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_CACHE_DIR=/composer-cache

WORKDIR /app
