{{- define "vmc.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "vmc.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "vmc.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "vmc.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: vm-operator
{{- end }}

{{- define "vmc.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vmc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "vmc.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vmc.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "vmc.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}
