from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_otel(settings):
    if not settings.otlp_endpoint:
        return
    resource = Resource.create({"service.name": "ssi-api"})
    provider = TracerProvider(resource=resource)
    processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otlp_endpoint))
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)
