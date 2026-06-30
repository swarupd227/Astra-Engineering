{{/*
Selector labels must match across Deployment, Service, HPA, PDB.
*/}}
{{- define "devx.selectorLabels" -}}
app.kubernetes.io/name: devx
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "devx.labels" -}}
{{ include "devx.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
