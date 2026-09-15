"""§스트리밍: the server-sent events parser, and the JSON text the adapters produce."""

from __future__ import annotations

from goondan.models._sse import SseParser
from goondan.models._values import is_blank, json_equal, json_text, merge_objects, strip_nulls


def parse(chunks: list[bytes | str]) -> list[str]:
    parser = SseParser()
    events: list[str] = []
    for chunk in chunks:
        events.extend(parser.push(chunk.encode("utf-8") if isinstance(chunk, str) else chunk))
    events.extend(parser.end())
    return events


def test_ends_lines_on_crlf_lf_and_cr():
    assert parse(["data: a\r\n\r\ndata: b\n\ndata: c\r\rdata: d\n\n"]) == ["a", "b", "c", "d"]


def test_joins_a_cr_at_the_end_of_a_chunk_with_an_lf_at_the_start_of_the_next():
    assert parse(["data: a\r", "\ndata: b\n\n"]) == ["a\nb"]
    assert parse(["data: a\r", "\n\r", "\ndata: b\r", "\r"]) == ["a", "b"]


def test_decodes_utf8_characters_split_across_chunks_byte_by_byte():
    payload = 'data: {"t":"안녕 😀"}\n\n'.encode("utf-8")
    assert parse([payload[index:index + 1] for index in range(len(payload))]) == ['{"t":"안녕 😀"}']


def test_skips_comments_joins_data_lines_and_ignores_other_fields():
    text = ': keep-alive\n\nevent: message\nid: 7\nretry: 10\ndata: {"a":\ndata: 1}\n\n'
    assert parse([text]) == ['{"a":\n1}']


def test_removes_only_one_leading_space_and_accepts_a_field_without_a_colon():
    assert parse(["data:x\n\ndata:  y\n\ndata\n\n"]) == ["x", " y", ""]


def test_dispatches_a_last_event_without_a_blank_line():
    assert parse(["data: last"]) == ["last"]
    assert parse(["data: last\r"]) == ["last"]


def test_dispatches_nothing_for_events_without_data():
    assert parse(["event: ping\n\n: comment\n\n"]) == []


def test_json_text_matches_json_stringify():
    assert json_text({"b": 1, "a": [1, 2]}) == '{"b":1,"a":[1,2]}'
    assert json_text({"n": 1.0, "half": 0.5}) == '{"n":1,"half":0.5}'
    assert json_text({"text": "안녕", "quote": '"', "line": "\n"}) == '{"text":"안녕","quote":"\\"","line":"\\n"}'
    assert json_text([True, False, None]) == "[true,false,null]"


def test_is_blank_follows_javascript_trim():
    assert is_blank(" \t\n\r\u00a0\u2028\u3000\ufeff")
    assert is_blank("")
    assert not is_blank(" x ")
    # U+200B is not JavaScript whitespace, so it is not blank.
    assert not is_blank("\u200b")


def test_merge_objects_replaces_arrays_and_strip_nulls_drops_null_keys():
    assert merge_objects({"a": {"x": 1, "y": 2}, "list": [1]}, {"a": {"y": 3}, "list": [2, 3]}) == {"a": {"x": 1, "y": 3}, "list": [2, 3]}
    assert strip_nulls({"a": None, "b": {"c": None, "d": 1}}) == {"b": {"d": 1}}


def test_json_equal_separates_booleans_from_numbers():
    assert json_equal({"a": [1, {"b": "c"}]}, {"a": [1, {"b": "c"}]})
    assert not json_equal(True, 1)
    assert not json_equal(1, True)
    assert not json_equal([1, 2], [2, 1])
    assert json_equal(1, 1.0)
