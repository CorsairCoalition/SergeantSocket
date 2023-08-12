# Sergeant Socket

[Generally Genius](https://corsaircoalition.github.io/) (GG) is a modular generals.io bot framework for development and analysis of game strategies and actions. [CorsairCoalition](https://corsaircoalition.github.io/) is a collection of components that form the GG framework.

SergeantSocket is an IO module that connects to generals.io via socket.io, publishes all game updates to the Redis message broker, and receives command and actions from other components on Redis.

## Configuration

Download `config.example.json` from the [documentation repository](https://github.com/CorsairCoalition/docs) and make desired changes.

To setup other components, see the [detailed instructions](https://corsaircoalition.github.io/setup/) on the [project website](https://corsaircoalition.github.io/).

## Execution

Install and run the executable:

```sh
npm install -g @corsaircoalition/sergeant-socket
sergeant-socket config.json
```

or run directly from npm library:

```sh
npx @corsaircoalition/sergeant-socket config.json
```

or use docker:

```sh
docker run -it ./config.json:/config.json ghcr.io/corsaircoalition/sergeantsocket:latest
```

## Usage

```
Usage: @corsaircoalition/sergeant-socket [options] <configFile>

a modular generals.io bot that implements advanced learning techniques

Options:
  -V, --version       output the version number
  -d, --debug         enable debugging (default: false)
  -s, --set-username  attempt to set username (default: false)
  -h, --help          display help for command
```
