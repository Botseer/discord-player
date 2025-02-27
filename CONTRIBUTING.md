# Hello
This document is for people who want to contribute to this project!

# Creating a new package

Run `yarn bootstrap <packageName>` to create new package.

Example:

```sh
$ yarn bootstrap example-lib
```

This will create a package `@discord-player/example-lib` under `packages` dir.

# Testing the changes

* Run `yarn build` to build your changes
* Run `yarn workspace music-bot install` to make sure everything is up-to-date
* Create `.env.local` inside `apps/music-bot/src` and add your bot token to it (see `.env.example` for example)
* Run `yarn bot` to start the test bot

# Code Style

## Formatting
We are using **[Prettier](https://prettier.io)** to format the code.

## File names
- Always use `PascalCase` for the files containing classes (example: `Queue`, `Track`, `Player` etc.)

## Some Rules
- Use `camelCase` for `Function names`, `Variables`, etc. and `PascalCase` for `Class name`
- Do not make unused variables/imports
- Don't forget to write `JSDOC` for each property and method
- Use English language

# Pull Requests
- Use English language
- Explain what your update does
- Format the code properly with `npm run format`