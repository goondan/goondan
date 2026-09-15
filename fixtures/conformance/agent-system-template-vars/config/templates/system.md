agent={{ agent.name }} model={{ model }} locale={{ params.locale }}
{% for t in tools %}
tool={{ t.name }}
{% endfor %}
