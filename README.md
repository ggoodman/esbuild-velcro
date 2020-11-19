# ESBuild + Velcro as a service experiment

## Usage

Start reloading server:

```bash
PORT=8080 npx nodemon --watch 'src/**/*.ts' --exec npx ts-node src/index.ts
```

Send an example payload and observe the output:

```bash
curl -XPOST -H "Content-Type: application/json" -d @test.json -s http://localhost:8080/bundle | jq
```
