# Webtask hacks

A collection of experiments and hacks for getting the most (and sometimes too much) out of the [Webtask](https://webtask.io) platform.

## Compilers

### Workflow

The workflow compiler allows you to build compound webtasks that have one of two composition models:

1. `fanout` - Run a set of child webtasks in parallel, collecting response status codes.
2. `sequence` - Run one child webtask after the other, piping the output of one into the input of the next.

#### Usage:

1. Create a webtask with code using the following structure:

    ```json
    {
        "type": "fanout | sequence",
        "nodes": [
            {
                "name": "name_of_webtask_0"
            },
            {
                "name": "name_of_webtask_1"
            },
            {
                "name": "name_of_webtask_N"
            }
        ]
    }
    ```

2. Set the `wt-compiler` metadata property on your webtask to `webtask-hacks/workflow`.

3. Set the `wt-node-dependencies` metadata property to the stringified JSON of an object having a `webtask-hacks` property whose value is the latest version of this module.

    ```json
    {"webtask-hacks":"1.0.1"}
    ```

4. Optionally, set the `wt-workflow-debug` metadata property to a number corresponding to the minimum level of logs that will be output to your webtask logs.

    Supported levels are as follows:

    ```
    20: debug
    30: info
    40: warn
    50: error
    ```
