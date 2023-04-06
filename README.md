# Sergeant Socket

A message broker that connects to generals.io via socket.io, publishes all game updates to Redis, and receives command and actions from other components on Redis.

## Installation

```
npm install
npm run build
```

## Configuration

Copy `config.json.example` to `config.json` and enter your Redis configuration.

## Usage

```
node app
```
