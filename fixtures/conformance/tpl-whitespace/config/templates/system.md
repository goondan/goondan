{% if params.flag %}
  {# c #}
  X{{ params.v }}
{% endif %}
Y
  {%- if params.flag %}Z{% endif %}
  {{ params.v }}
