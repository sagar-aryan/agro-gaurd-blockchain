#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <TinyGPS++.h>

// ----------- WiFi -----------
const char* ssid = "kumbaya_static";
const char* password = "Uxy433jvce65536@";

IPAddress local_IP(192, 168, 1, 4);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);

// ----------- Server -----------
WebServer server(7070);

// ----------- Sensors -----------
Adafruit_BMP280 bmp;
TinyGPSPlus gps;
HardwareSerial GPS(2);

// ----------- Pins -----------
#define BUTTON_PIN 14
#define M1 36
#define M2 34
#define M3 35
#define M4 32

// ----------- Data Struct -----------
struct SensorData {
  int m1, m2, m3, m4;
  float temp, pressure;
  double lat, lon;
  bool gpsValid;
};

SensorData lastData;

// ----------- Flags -----------
volatile bool buttonPressed = false;

// ----------- Interrupt -----------
void IRAM_ATTR handleButton() {
  buttonPressed = true;
}

// ----------- WiFi Setup -----------
void setupWiFi() {
  WiFi.config(local_IP, gateway, subnet);
  WiFi.begin(ssid, password);

  Serial.print("Connecting...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nConnected!");
  Serial.println(WiFi.localIP());
}

// ----------- Sensor Init -----------
void initBMP() {
  Wire.begin(21, 22);
  if (!bmp.begin(0x76)) {
    Serial.println("BMP280 not found!");
    while (1);
  }
}

void initGPS() {
  GPS.begin(9600, SERIAL_8N1, 16, 17);
}

void initButton() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), handleButton, FALLING);
}

// ----------- Read Sensors -----------
void readSensors() {
  lastData.m1 = analogRead(M1);
  lastData.m2 = analogRead(M2);
  lastData.m3 = analogRead(M3);
  lastData.m4 = analogRead(M4);

  lastData.temp = bmp.readTemperature();
  lastData.pressure = bmp.readPressure() / 100.0;
}

// ----------- Read GPS -----------
void readGPS() {
  while (GPS.available()) {
    gps.encode(GPS.read());
  }

  if (gps.location.isValid()) {
    lastData.lat = gps.location.lat();
    lastData.lon = gps.location.lng();
    lastData.gpsValid = true;
  } else {
    lastData.gpsValid = false;
  }
}

// ----------- JSON Builder -----------
String buildJSON() {
  String json = "{";

  json += "\"m1\":" + String(lastData.m1) + ",";
  json += "\"m2\":" + String(lastData.m2) + ",";
  json += "\"m3\":" + String(lastData.m3) + ",";
  json += "\"m4\":" + String(lastData.m4) + ",";
  json += "\"temp\":" + String(lastData.temp) + ",";
  json += "\"pressure\":" + String(lastData.pressure) + ",";

  if (lastData.gpsValid) {
    json += "\"lat\":" + String(lastData.lat, 6) + ",";
    json += "\"lon\":" + String(lastData.lon, 6);
  } else {
    json += "\"lat\":null,\"lon\":null";
  }

  json += "}";

  return json;
}

// ----------- API Handler -----------
void handleData() {
  String json = buildJSON();
  server.send(200, "application/json", json);
}

// ----------- Server Setup -----------
void setupServer() {
  server.on("/data", handleData);
  server.begin();
}

// ----------- Setup -----------
void setup() {
  Serial.begin(115200);

  setupWiFi();
  initBMP();
  initGPS();
  initButton();
  setupServer();

  Serial.println("System Ready");
}

// ----------- Loop -----------
void loop() {

  // Always update GPS stream
  readGPS();

  // Only update snapshot when button pressed
  if (buttonPressed) {
    readSensors();
    Serial.println("Data Captured");
    buttonPressed = false;
  }

  server.handleClient();
}