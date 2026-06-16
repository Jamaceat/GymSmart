FROM reactnativecommunity/react-native-android:latest

# Instalar rsync para sincronización rápida
RUN apt-get update && apt-get install -y rsync && rm -rf /var/lib/apt/lists/*

# Establecer el directorio de trabajo
WORKDIR /app

# Carpeta donde se montará el volumen para extraer el APK
RUN mkdir -p /output

# Comando por defecto que ejecuta el flujo de compilación desde el volumen del host
CMD ["/app/src-host/scripts/docker-build.sh"]
