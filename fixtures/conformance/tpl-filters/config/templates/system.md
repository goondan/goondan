{{ params.v | json(0) }}
{{ params.e | length }}|{{ params.arr | length }}|{{ params.obj | length }}
{{ params.s | trim }}|{{ params.ss | upper }}|{{ params.mixed | lower }}|{{ params.rep | replace("a","b",2) }}|{{ params.rep | replace("a","b") }}
{{ params.arr | join }}|{{ params.arr | join('-') }}|{{ params.missing | default('z') }}|{{ params.n | upper }}
{{ params.v | json }}
