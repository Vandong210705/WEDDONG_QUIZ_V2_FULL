#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>

const char* WIFI_SSID = "Vandong";
const char* WIFI_PASSWORD = "vandong123";
const char* MQTT_BROKER = "broker.emqx.io";
const uint16_t MQTT_PORT = 1883;
const char* TOPIC_SUBMIT = "lagan50ki/quiz/submit";
const char* TOPIC_CHECKIN = "lagan50ki/quiz/checkin";
const char* TOPIC_QUESTION = "lagan50ki/quiz/question";

// Index: 0,1,2,3,4,5,6,7,8,9,ENTER,RESET. Da test tren PCB.
const uint8_t buttonPins[12] = {
  32, 16, 23, 26, 17, 25, 27, 18, 33, 14, 13, 19
};
const uint8_t LED_PIN = 21;
const uint8_t KEY_ENTER = 10;
const uint8_t KEY_RESET = 11;
const unsigned long DEBOUNCE_MS = 45;
// Chi ngu khi chua nhap STT va khong co thao tac trong 5 phut.
const unsigned long SLEEP_IDLE_MS = 5UL * 60UL * 1000UL;
// Phim so 8 tren GPIO33 (RTC GPIO) de danh thuc.
const gpio_num_t WAKEUP_GPIO = GPIO_NUM_33;
const unsigned long WIFI_RETRY_MS = 20000UL;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
String idBuffer = "";
String responseTopic = "";
int deviceId = 0;
char selectedAnswer = '\0';
bool idReady = false;
bool hasSubmitted = false;
bool ledState = false;
bool stableState[12];
bool lastReading[12];
unsigned long lastChange[12];
unsigned long lastLedToggle = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
unsigned long lastKeyActivity = 0;
uint64_t currentRevision = 0;
int currentQuestion = -1;

void updateLed() {
  if (hasSubmitted) {
    if (!ledState) {
      ledState = true;
      digitalWrite(LED_PIN, HIGH);
    }
    return;
  }
  unsigned long interval = idReady ? 200UL : 1000UL;
  unsigned long now = millis();
  if (now - lastLedToggle >= interval) {
    lastLedToggle = now;
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState ? HIGH : LOW);
  }
}

void publishCheckin(const char* status) {
  if (deviceId <= 0 || !mqttClient.connected()) return;
  String data = "{\"device_id\":" + String(deviceId) + ",\"status\":\"" + status + "\"}";
  bool ok = mqttClient.publish(TOPIC_CHECKIN, data.c_str());
  Serial.print("CHECKIN: "); Serial.println(data);
  Serial.println(ok ? "GUI CHECKIN MQTT OK" : "GUI CHECKIN MQTT LOI");
}

// Parse simple integer fields from the server-generated MQTT JSON.
long long jsonNumber(const String& text, const String& field, long long fallback = -1) {
  String key = "\"" + field + "\":";
  int pos = text.indexOf(key);
  if (pos < 0) return fallback;
  pos += key.length();
  while (pos < text.length() && text[pos] == ' ') pos++;
  String number;
  while (pos < text.length() && isDigit(text[pos])) number += text[pos++];
  return number.length() ? atoll(number.c_str()) : fallback;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i=0; i<length; ++i) message += (char)payload[i];
  String topicName(topic);

  if (topicName == TOPIC_QUESTION) {
    if (!idReady) return;
    if (message.indexOf("\"action\":\"new_question\"") >= 0) {
      long long revision = jsonNumber(message, "revision");
      int question = (int)jsonNumber(message, "question_index");
      if (revision > 0 && (uint64_t)revision != currentRevision) {
        currentRevision = (uint64_t)revision;
        currentQuestion = question;
        hasSubmitted = false;
        selectedAnswer = '\0';
        ledState = false;
        lastLedToggle = millis();
        digitalWrite(LED_PIN, LOW);
        Serial.print("CAU MOI "); Serial.print(question + 1);
        Serial.println(" - LED CHOP NHANH 200ms");
      }
    } else if (message.indexOf("\"action\":\"question_locked\"") >= 0) {
      Serial.println("GIAO VIEN DA CHOT CAU - KHONG GUI LAI");
    }
    return;
  }

  if (!idReady || topicName != responseTopic) return;
  Serial.print("SERVER: "); Serial.println(message);
  if (message.indexOf("\"success\":true") >= 0) {
    long long revision = jsonNumber(message, "revision");
    if (currentRevision > 0 && revision > 0 && (uint64_t)revision != currentRevision) {
      Serial.println("Bo qua xac nhan cua cau hoi cu");
      return;
    }
    hasSubmitted = true; // Only after backend confirms saving the answer.
    ledState = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("DA LUU DAP AN - LED SANG LIEN TUC, DOI GIAO VIEN CHOT");
  } else if (message.indexOf("\"error\"") >= 0) {
    Serial.println("LOI: CAU CHUA PHAT, DA CHOT HOAC STT KHONG HOP LE");
  }
}

void maintainNetwork() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    // Khong goi WiFi.mode()/WiFi.begin() lien tuc khi STA dang connecting.
    // Thu vien tu reconnect; chi yeu cau reconnect khi trang thai that bai.
    wl_status_t status = WiFi.status();
    if (now - lastWifiAttempt >= WIFI_RETRY_MS &&
        (status == WL_DISCONNECTED || status == WL_CONNECT_FAILED ||
         status == WL_NO_SSID_AVAIL || status == WL_CONNECTION_LOST)) {
      lastWifiAttempt = now;
      Serial.println("WiFi mat ket noi - thu reconnect...");
      WiFi.reconnect();
    }
    return;
  }
  if (mqttClient.connected()) { mqttClient.loop(); return; }
  if (now - lastMqttAttempt < 3000UL) return;
  lastMqttAttempt = now;
  String clientId = "ESP32-QUIZ-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);
  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("MQTT OK");
    mqttClient.subscribe(TOPIC_QUESTION);
    if (idReady) {
      responseTopic = "lagan50ki/quiz/response/" + String(deviceId);
      mqttClient.subscribe(responseTopic.c_str());
      publishCheckin("joined");
    }
  } else {
    Serial.print("MQTT LOI: "); Serial.println(mqttClient.state());
  }
}

void checkIdleSleep() {
  if (idReady || idBuffer.length() > 0) return; // Khong ngu giua phien / khi nhap STT.
  if (millis() - lastKeyActivity < SLEEP_IDLE_MS) return;
  // GPIO33 la phim 8, active LOW; tranh vao ngu khi phim dang bi giu.
  if (digitalRead((int)WAKEUP_GPIO) == LOW) return;
  Serial.println("Khong thao tac 5 phut - DEEP SLEEP. Nhan phim 8 de bat lai.");
  Serial.flush();
  mqttClient.disconnect();
  WiFi.disconnect(true);
  digitalWrite(LED_PIN, LOW);
  // EXT0 danh thuc bang muc LOW; GPIO33 ho tro RTC tren ESP32 classic.
  rtc_gpio_pullup_en(WAKEUP_GPIO);
  rtc_gpio_pulldown_dis(WAKEUP_GPIO);
  esp_sleep_enable_ext0_wakeup(WAKEUP_GPIO, 0);
  esp_deep_sleep_start();
}

void resetDevice() {
  if (idReady) {
    publishCheckin("left");
    if (mqttClient.connected()) mqttClient.unsubscribe(responseTopic.c_str());
  }
  idBuffer = "";
  deviceId = 0;
  selectedAnswer = '\0';
  idReady = false;
  hasSubmitted = false;
  ledState = false;
  currentQuestion = -1;
  currentRevision = 0;
  lastLedToggle = millis();
  digitalWrite(LED_PIN, LOW);
  responseTopic = "";
  Serial.println("====================");
  Serial.println("RESET - NHAP STT MOI");
  Serial.println("====================");
}

void confirmID() {
  if (!idBuffer.length()) { Serial.println("Chua nhap STT"); return; }
  int parsed = idBuffer.toInt();
  if (parsed <= 0) { Serial.println("STT khong hop le"); idBuffer=""; return; }
  if (!mqttClient.connected()) { Serial.println("MQTT chua ket noi, ENTER de thu lai"); return; }
  deviceId = parsed;
  idReady = true;
  hasSubmitted = false;
  ledState = false;
  lastLedToggle = millis();
  digitalWrite(LED_PIN, LOW);
  idBuffer = "";
  responseTopic = "lagan50ki/quiz/response/" + String(deviceId);
  mqttClient.subscribe(responseTopic.c_str());
  publishCheckin("joined");
  Serial.print("STT = "); Serial.println(deviceId);
  Serial.println("SAN SANG: 1=A 2=B 3=C 4=D, ENTER=GUI");
}

void sendAnswer() {
  if (selectedAnswer == '\0') { Serial.println("Chua chon dap an"); return; }
  if (!mqttClient.connected()) { Serial.println("MQTT chua ket noi"); return; }
  String data = "{\"device_id\":" + String(deviceId) + ",\"answer\":\"" + String(selectedAnswer) + "\"}";
  Serial.print("GUI: "); Serial.println(data);
  if (mqttClient.publish(TOPIC_SUBMIT,data.c_str())) {
    Serial.println("MQTT DA GUI - DOI BACKEND XAC NHAN");
    selectedAnswer='\0';
  } else Serial.println("GUI MQTT THAT BAI");
}

void processKey(uint8_t key) {
  lastKeyActivity = millis();
  if (key == KEY_RESET) { resetDevice(); return; }
  if (!idReady) {
    if (key <= 9) {
      if (idBuffer.length() >= 9) { Serial.println("STT qua dai"); return; }
      idBuffer += String(key);
      Serial.print("Nhap STT: "); Serial.println(idBuffer);
    } else if (key == KEY_ENTER) confirmID();
    return;
  }
  if (key >= 1 && key <= 4) {
    selectedAnswer = char('A' + key - 1);
    Serial.print("Da chon: "); Serial.println(selectedAnswer);
  } else if (key == KEY_ENTER) sendAnswer();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(LED_PIN,OUTPUT);
  digitalWrite(LED_PIN,LOW);
  lastLedToggle=millis();
  lastKeyActivity=millis();
  for(uint8_t i=0;i<12;i++) {
    pinMode(buttonPins[i],INPUT_PULLUP);
    stableState[i]=digitalRead(buttonPins[i]);
    lastReading[i]=stableState[i];
    lastChange[i]=millis();
  }
  mqttClient.setServer(MQTT_BROKER,MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  lastWifiAttempt=millis();
  Serial.println("ESP32 PCB QUIZ READY - NHAP STT:");
}

void loop() {
  maintainNetwork();
  updateLed();
  checkIdleSleep();
  unsigned long now=millis();
  for(uint8_t i=0;i<12;i++) {
    bool reading=digitalRead(buttonPins[i]);
    if(reading != lastReading[i]) lastChange[i]=now;
    lastReading[i]=reading;
    if((now-lastChange[i]>=DEBOUNCE_MS) && reading!=stableState[i]) {
      stableState[i]=reading;
      if(reading==LOW)processKey(i);
    }
  }
  delay(2);
}
