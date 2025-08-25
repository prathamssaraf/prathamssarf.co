;(function () {
	
	'use strict';

	var isMobile = {
		Android: function() {
			return navigator.userAgent.match(/Android/i);
		},
			BlackBerry: function() {
			return navigator.userAgent.match(/BlackBerry/i);
		},
			iOS: function() {
			return navigator.userAgent.match(/iPhone|iPad|iPod/i);
		},
			Opera: function() {
			return navigator.userAgent.match(/Opera Mini/i);
		},
			Windows: function() {
			return navigator.userAgent.match(/IEMobile/i);
		},
			any: function() {
			return (isMobile.Android() || isMobile.BlackBerry() || isMobile.iOS() || isMobile.Opera() || isMobile.Windows());
		}
	};

	
	var fullHeight = function() {

		if ( !isMobile.any() ) {
			$('.js-fullheight').css('height', $(window).height());
			$(window).resize(function(){
				$('.js-fullheight').css('height', $(window).height());
			});
		}
	};

	// Parallax
	var parallax = function() {
		$(window).stellar();
	};

	var contentWayPoint = function() {
		var i = 0;
		$('.animate-box').waypoint( function( direction ) {

			if( direction === 'down' && !$(this.element).hasClass('animated-fast') ) {
				
				i++;

				$(this.element).addClass('item-animate');
				setTimeout(function(){

					$('body .animate-box.item-animate').each(function(k){
						var el = $(this);
						setTimeout( function () {
							var effect = el.data('animate-effect');
							if ( effect === 'fadeIn') {
								el.addClass('fadeIn animated-fast');
							} else if ( effect === 'fadeInLeft') {
								el.addClass('fadeInLeft animated-fast');
							} else if ( effect === 'fadeInRight') {
								el.addClass('fadeInRight animated-fast');
							} else {
								el.addClass('fadeInUp animated-fast');
							}

							el.removeClass('item-animate');
						},  k * 100, 'easeInOutExpo' );
					});
					
				}, 50);
				
			}

		} , { offset: '85%' } );
	};



	var goToTop = function() {

		$('.js-gotop').on('click', function(event){
			
			event.preventDefault();

			$('html, body').animate({
				scrollTop: $('html').offset().top
			}, 500, 'easeInOutExpo');
			
			return false;
		});

		$(window).scroll(function(){

			var $win = $(window);
			if ($win.scrollTop() > 200) {
				$('.js-top').addClass('active');
			} else {
				$('.js-top').removeClass('active');
			}

		});
	
	};

	// Smooth scroll for contact button
	var smoothScroll = function() {
		$('a[href*="#"]:not([href="#"])').click(function() {
			if (location.pathname.replace(/^\//,'') == this.pathname.replace(/^\//,'') && location.hostname == this.hostname) {
				var target = $(this.hash);
				target = target.length ? target : $('[name=' + this.hash.slice(1) +']');
				if (target.length) {
					$('html, body').animate({
						scrollTop: target.offset().top
					}, 1000, 'easeInOutExpo');
					return false;
				}
			}
		});
	};

	var pieChart = function() {
		$('.chart').easyPieChart({
			scaleColor: false,
			lineWidth: 4,
			lineCap: 'butt',
			barColor: '#FF9000',
			trackColor:	"#f5f5f5",
			size: 160,
			animate: 1000
		});
	};

	var skillsWayPoint = function() {
		if ($('#fh5co-skills').length > 0 ) {
			$('#fh5co-skills').waypoint( function( direction ) {
										
				if( direction === 'down' && !$(this.element).hasClass('animated') ) {
					setTimeout( pieChart , 400);					
					$(this.element).addClass('animated');
				}
			} , { offset: '90%' } );
		}

	};


	// Loading page
	var loaderPage = function() {
		$(".fh5co-loader").fadeOut("slow");
	};

	
	// Contact form handling
	var contactForm = function() {
		// Initialize EmailJS
		emailjs.init("YOUR_PUBLIC_KEY"); // Replace with your EmailJS public key
		
		$('#contact-form').on('submit', function(e) {
			e.preventDefault();
			
			var submitBtn = $('#submit-btn');
			var statusDiv = $('#contact-status');
			var form = this;
			
			// Show loading state
			submitBtn.val('Sending...');
			submitBtn.prop('disabled', true);
			statusDiv.hide();
			
			// Get form data
			var templateParams = {
				from_name: $('#fname').val() + ' ' + $('#lname').val(),
				from_email: $('#email').val(),
				subject: $('#subject').val(),
				message: $('#message').val(),
				to_name: 'Pratham Saraf'
			};
			
			// Send email using EmailJS
			// Replace 'YOUR_SERVICE_ID' and 'YOUR_TEMPLATE_ID' with your actual EmailJS service and template IDs
			emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', templateParams)
				.then(function(response) {
					console.log('SUCCESS!', response.status, response.text);
					
					// Show success message
					statusDiv.html('<strong>Success!</strong> Your message has been sent successfully. I\'ll get back to you soon!');
					statusDiv.css({
						'background-color': '#d4edda',
						'border-color': '#c3e6cb',
						'color': '#155724'
					});
					statusDiv.show();
					
					// Reset form
					form.reset();
					
				}, function(error) {
					console.log('FAILED...', error);
					
					// Show error message with fallback
					statusDiv.html('<strong>Oops!</strong> There was an error sending your message. Please try again or contact me directly at <a href="mailto:prathamssaraf@gmail.com">prathamssaraf@gmail.com</a>');
					statusDiv.css({
						'background-color': '#f8d7da',
						'border-color': '#f5c6cb',
						'color': '#721c24'
					});
					statusDiv.show();
				})
				.finally(function() {
					// Reset button state
					submitBtn.val('Send Message');
					submitBtn.prop('disabled', false);
				});
		});
	};

	$(function(){
		contentWayPoint();
		goToTop();
		loaderPage();
		fullHeight();
		parallax();
		// pieChart();
		skillsWayPoint();
		contactForm();
		smoothScroll();
	});


}());