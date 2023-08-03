# Sergeant Socket

A message broker that connects to generals.io via socket.io, publishes all game updates to Redis, and receives command and actions from other components on Redis.

## Installation

```
npm install
npm run build
```

## Configuration

See `[config.json.example](https://github.com/CorsairCoalition/docs/blob/main/config.json.example)`.

## Usage

```
node . config.json
```
