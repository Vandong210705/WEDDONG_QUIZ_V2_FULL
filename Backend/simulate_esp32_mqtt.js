const mqtt = require('mqtt');
const readline = require('readline');

// Bảng điều khiển (Serial Monitor ảo)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("==================================================");
console.log("🚀 BỘ GIẢ LẬP ESP32 BẮN ĐẠN QUA GIAO THỨC MQTT");
console.log("==================================================");

// Khởi động module WiFi & MQTT 
const client = mqtt.connect('mqtt://broker.emqx.io');
const MQTT_TOPIC_SUBMIT = 'lagan50ki/quiz/submit';

client.on('connect', () => {
  console.log('✅ ESP32 đã bắt tay thành công với MQTT Broker!');
  // Đăng ký nghe ngóng kết quả trả về
  client.subscribe('lagan50ki/quiz/response/#');
  
  // Hướng dẫn nhập bằng STT
  console.log("👉 Cú pháp bấm nút ảo: [STT] [Đáp Án] (Ví dụ: 1 A, 2 B)");
  rl.prompt();
});

// Hàm ngắt (Interrupt) nhận kết quả chấm điểm từ Server
client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  // Tách lấy STT từ cái topic (VD: lagan50ki/quiz/response/1 -> STT là 1)
  const stt = topic.split('/').pop(); 
  
  if (data.success) {
    console.log(`\n🛎️ [SERVER BÁO VỀ MÁY CỦA STT ${stt}]: ${data.isCorrect ? 'ĐÚNG! (Bật đèn XANH 🟢)' : 'SAI! (Bật đèn ĐỎ 🔴)'}`);
  } else {
    console.log(`\n⚠️ [SERVER BÁO VỀ MÁY CỦA STT ${stt}]: LỖI - ${data.error}`);
  }
  rl.prompt();
});

// Vòng lặp chờ bấm nút 
rl.on('line', (input) => {
  const command = input.trim();
  if (command.toLowerCase() === 'exit') process.exit(0);

  const parts = command.split(' ');
  if (parts.length === 2) {
    const stt = parts[0];
    const answer = parts[1].toUpperCase();
    
    // ĐÓNG GÓI JSON: Bản chất device_id gửi lên Server chính là STT
    const payload = JSON.stringify({ 
      device_id: parseInt(stt), 
      answer: answer 
    });
    
    console.log(`\n[ESP32 của STT ${stt}] đang Publish đáp án [${answer}]...`);
    client.publish(MQTT_TOPIC_SUBMIT, payload);
  } else {
    console.log("⚠️ Lệnh sai! Vui lòng gõ: <Số_Thứ_Tự> <Đáp_Án> (Ví dụ: 1 A)");
    rl.prompt();
  }
});