.PHONY: help install start start-tunnel android web clean reset prebuild local-apk local-apk-rebuild local-apk-clean eas-login eas-config eas-apk eas-aab adb-reverse start-tablet open-tablet

# Puerto para depuración móvil (configurable vía: make <target> PORT=xxxx)
PORT ?= 8082

# Gestor de paquetes por defecto (npm)
PACKAGE_MANAGER = npm

# Color de terminal
BLUE  = \033[1;34m
GREEN = \033[1;32m
RESET = \033[0m

help:
	@echo "================================================================="
	@echo "  $(BLUE)GymSmart - Comandos para Desarrollo y Construcción$(RESET)"
	@echo "================================================================="
	@echo "Uso: make <comando>"
	@echo ""
	@echo "$(BLUE)Desarrollo:$(RESET)"
	@echo "  install          Instala las dependencias del proyecto"
	@echo "  start            Inicia el Metro Bundler de Expo"
	@echo "  start-tunnel     Inicia el Metro Bundler con túnel de Ngrok (para Expo Go externo)"
	@echo "  android          Inicia el servidor y abre en emulador/dispositivo Android"
	@echo "  web              Inicia el servidor y abre en navegador web"
	@echo "  adb-reverse      Configura la redirección de puertos USB para depurar en tablet (puerto $(PORT))"
	@echo "  start-tablet     Inicia Metro en puerto $(PORT) y configura redirección ADB"
	@echo "  open-tablet      Abre la aplicación en la tablet conectada por USB (abre Expo Go)"
	@echo "  clean            Limpia la caché del empaquetador Metro y Expo"
	@echo "  reset            Ejecuta el script de reinicio del proyecto"
	@echo ""
	@echo "$(BLUE)Compilación Local (Aislada con Docker):$(RESET)"
	@echo "  prebuild          Genera las carpetas nativas de Android e iOS (expo prebuild)"
	@echo "  local-apk         Genera el archivo APK localmente reutilizando caché"
	@echo "  local-apk-rebuild Reconstruye la imagen Docker base y compila el APK"
	@echo "  local-apk-clean   Elimina todas las cachés persistentes (volúmenes de Docker)"
	@echo ""
	@echo "$(BLUE)Compilación Nube (EAS Build - Recomendado):$(RESET)"
	@echo "  eas-login        Inicia sesión en Expo CLI"
	@echo "  eas-config       Inicializa y configura EAS Build (crea eas.json)"
	@echo "  eas-apk          Compila en la nube y genera un APK instalable (perfil preview)"
	@echo "  eas-aab          Compila en la nube y genera un AAB para la Play Store (perfil production)"
	@echo "================================================================="

install:
	@echo "$(BLUE)Instalando dependencias...$(RESET)"
	$(PACKAGE_MANAGER) install
	@echo "$(GREEN)Dependencias instaladas exitosamente.$(RESET)"

start:
	npx expo start --port $(PORT)

start-tunnel:
	npx expo start --tunnel

android:
	npx expo start --android

web:
	npx expo start --web

adb-reverse:
	@echo "$(BLUE)Configurando redirección de puerto $(PORT) vía ADB...$(RESET)"
	adb reverse tcp:$(PORT) tcp:$(PORT)
	@echo "$(GREEN)Puerto $(PORT) redireccionado con éxito. Ejecuta 'make start-tablet' o 'make open-tablet'.$(RESET)"

start-tablet: adb-reverse
	npx expo start --port $(PORT)

open-tablet:
	@echo "$(BLUE)Abriendo la aplicación en la tablet (Expo Go)...$(RESET)"
	adb shell am start -a android.intent.action.VIEW -d "exp://localhost:$(PORT)"

clean:
	@echo "$(BLUE)Limpiando caché de Metro y carpeta de salida...$(RESET)"
	npx expo start -c
	rm -rf dist
	@echo "$(GREEN)Limpieza completada.$(RESET)"

reset:
	@echo "$(BLUE)Ejecutando reinicio completo...$(RESET)"
	$(PACKAGE_MANAGER) run reset-project

prebuild:
	@echo "$(BLUE)Generando directorios nativos...$(RESET)"
	npx expo prebuild --clean
	@echo "$(GREEN)Directorios nativos generados.$(RESET)"

local-apk:
	@echo "$(BLUE)Asegurando carpeta dist...$(RESET)"
	mkdir -p dist
	@echo "$(BLUE)Asegurando permisos de ejecución para el script de compilación...$(RESET)"
	chmod +x scripts/docker-build.sh
	@echo "$(BLUE)Iniciando compilación en Docker (usa caché de ejecuciones previas)...$(RESET)"
	USER_ID=$$(id -u) GROUP_ID=$$(id -g) docker compose up
	@echo "$(BLUE)Limpiando contenedor de compilación...$(RESET)"
	docker compose down
	@echo "$(GREEN)Compilación finalizada.$(RESET)"
	@echo "El archivo APK se encuentra en: $(BLUE)./dist/gymsmart.apk$(RESET)"

local-apk-rebuild:
	@echo "$(BLUE)Reconstruyendo imagen Docker y compilando APK...$(RESET)"
	mkdir -p dist
	chmod +x scripts/docker-build.sh
	USER_ID=$$(id -u) GROUP_ID=$$(id -g) docker compose up --build
	docker compose down
	@echo "$(GREEN)Compilación finalizada.$(RESET)"

local-apk-clean:
	@echo "$(BLUE)Eliminando contenedores y volúmenes de caché de Docker...$(RESET)"
	docker compose down -v
	@echo "$(GREEN)Cachés eliminadas con éxito.$(RESET)"

eas-login:
	npx eas login

eas-config:
	npx eas build:configure

eas-apk:
	@echo "$(BLUE)Enviando compilación a la nube de Expo (APK - Preview)...$(RESET)"
	npx eas build --platform android --profile preview

eas-aab:
	@echo "$(BLUE)Enviando compilación a la nube de Expo (AAB - Production)...$(RESET)"
	npx eas build --platform android --profile production
