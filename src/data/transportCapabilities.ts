// Contrato de build: qualquer transporte futuro deve declarar-se aqui e registrar
// presença em sync_meta ANTES de ler/reservar/enviar outbox. A retenção local bloqueia ambos.
export const RETENTION_TRANSPORT_CAPABILITY = Object.freeze({
  schema: "local-only-retention-v1",
  consumers: Object.freeze([] as string[]),
});
