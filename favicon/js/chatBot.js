     // DOM Elements
        const chatButton = document.getElementById('chatButton');
        const chatWindow = document.getElementById('chatWindow');
        const closeBtn = document.getElementById('closeBtn');
        const chatMessages = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendBtn');

        // Toggle chat window
        chatButton.addEventListener('click', () => {
            chatWindow.classList.add('active');
        });

        closeBtn.addEventListener('click', () => {
            chatWindow.classList.remove('active');
        });

        // Quick question buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('quick-question-btn')) {
                const question = e.target.getAttribute('data-question');
                sendMessage(question);
            }
        });

        // Send message on button click
        sendBtn.addEventListener('click', () => {
            const message = chatInput.value.trim();
            if (message) {
                sendMessage(message);
            }
        });

        // Send message on Enter key
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const message = chatInput.value.trim();
                if (message) {
                    sendMessage(message);
                }
            }
        });

        // Send message function
        function sendMessage(message) {
            // Add user message
            addMessage(message, 'user');
            chatInput.value = '';

            // Show typing indicator
            showTypingIndicator();

            // Get AI response
            setTimeout(() => {
                getAIResponse(message);
            }, 1000);
        }

        // Add message to chat
        function addMessage(text, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${sender}`;
            messageDiv.innerHTML = `<div class="message-content">${text}</div>`;
            
            // Remove typing indicator if exists
            const typingIndicator = document.querySelector('.typing-indicator');
            if (typingIndicator) {
                typingIndicator.parentElement.remove();
            }
            
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        // Show typing indicator
        function showTypingIndicator() {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot';
            messageDiv.innerHTML = `
                <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        // Knowledge base for the academy
        const knowledgeBase = {
            courses: "We offer a variety of courses including Web Development, Data Science, Mobile App Development, UI/UX Design, Digital Marketing, and Cloud Computing. All courses are designed by industry experts and include hands-on projects.",
            
            teaching: "Our teaching mode combines live online classes, recorded video lessons, interactive assignments, and one-on-one mentorship. Students can learn at their own pace with 24/7 access to course materials.",
            
            history: "Our academy was founded in 2020 with a mission to make quality tech education accessible to everyone. We've since helped over 10,000 students launch their tech careers.",
            
            requirements: "Basic computer literacy and internet connection are the main requirements. Some advanced courses may require prerequisite knowledge, which is clearly mentioned in the course description.",
            
            founder: "The academy was founded by tech industry veterans with over 20 years of combined experience in education and software development.",
            
            team: "Our team consists of experienced instructors, industry professionals, career coaches, and dedicated support staff committed to your success.",
            
            getstarted: "Getting started is easy! 1) Browse our course catalog, 2) Select a course that interests you, 3) Complete the enrollment form, 4) Make payment, 5) Get immediate access to course materials. We also offer free trial lessons!",
            
            dashboard: "Your dashboard is your learning hub. From there you can: access your enrolled courses, track your progress, submit assignments, view grades, communicate with instructors, and manage your profile. Navigate using the menu on the left side.",
            
            payment: "We accept various payment methods including credit/debit cards, PayPal, and bank transfers. We also offer flexible payment plans and installment options for most courses.",
            
            certificate: "Yes! Upon successful completion of a course (70% or higher), you'll receive a verified certificate that you can share on LinkedIn and include in your resume.",
            
            support: "Our support team is available 24/7 via this chat, email, or phone. We typically respond within 2 hours during business days.",
            
            duration: "Course durations vary from 4 weeks to 6 months depending on the program. You can learn at your own pace, and all course materials remain accessible for 12 months after enrollment."
        };

        // Simple AI response function (you'll replace this with actual API)
        function getAIResponse(userMessage) {
            const lowerMessage = userMessage.toLowerCase();
            let response = " ";

            // Simple keyword matching
            if (lowerMessage.includes('course') || lowerMessage.includes('program')) {
                response += knowledgeBase.courses;
            } else if (lowerMessage.includes('teach') || lowerMessage.includes('learn') || lowerMessage.includes('mode')) {
                response += knowledgeBase.teaching;
            } else if (lowerMessage.includes('history') || lowerMessage.includes('about') || lowerMessage.includes('academy')) {
                response += knowledgeBase.history;
            } else if (lowerMessage.includes('requirement') || lowerMessage.includes('prerequisite')) {
                response += knowledgeBase.requirements;
            } else if (lowerMessage.includes('founder')) {
                response += knowledgeBase.founder;
            } else if (lowerMessage.includes('team') || lowerMessage.includes('instructor')) {
                response += knowledgeBase.team;
            } else if (lowerMessage.includes('start') || lowerMessage.includes('enroll') || lowerMessage.includes('join')) {
                response += knowledgeBase.getstarted;
            } else if (lowerMessage.includes('dashboard') || lowerMessage.includes('navigate')) {
                response += knowledgeBase.dashboard;
            } else if (lowerMessage.includes('pay') || lowerMessage.includes('price') || lowerMessage.includes('cost')) {
                response += knowledgeBase.payment;
            } else if (lowerMessage.includes('certificate') || lowerMessage.includes('certification')) {
                response += knowledgeBase.certificate;
            } else if (lowerMessage.includes('support') || lowerMessage.includes('help') || lowerMessage.includes('contact')) {
                response += knowledgeBase.support;
            } else if (lowerMessage.includes('duration') || lowerMessage.includes('long') || lowerMessage.includes('time')) {
                response += knowledgeBase.duration;
            } else {
                response = "I understand you're asking about: '" + userMessage + "'. Could you please provide more details? You can also ask me about our courses, enrollment process, teaching methods, requirements, or how to navigate your dashboard. or would you like to speak to a human representative for further assistance.";
            }

            addMessage(response, 'bot');
        }

        // Optional: Integrate with Hugging Face API (FREE)
        // Uncomment and add your API key to use real AI
        /*
        async function getAIResponseFromAPI(userMessage) {
            const API_KEY = 'YOUR_HUGGINGFACE_API_KEY'; // Get free key from huggingface.co
            const API_URL = 'https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium';
            
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        inputs: userMessage,
                    }),
                });
                
                const data = await response.json();
                const aiResponse = data[0].generated_text;
                addMessage(aiResponse, 'bot');
            } catch (error) {
                addMessage("I'm having trouble connecting right now. Please try again in a moment.", 'bot');
            }
        }
        */