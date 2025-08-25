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

	
	// Contact form handling with mailto
	var contactForm = function() {
		$('#contact-form').on('submit', function(e) {
			e.preventDefault();
			
			var submitBtn = $('#submit-btn');
			var statusDiv = $('#contact-status');
			var form = this;
			
			// Get form data
			var firstname = $('input[name="firstname"]').val();
			var lastname = $('input[name="lastname"]').val();
			var email = $('input[name="email"]').val();
			var subject = $('input[name="subject"]').val();
			var message = $('textarea[name="message"]').val();
			
			// Create email body
			var emailBody = 'Hello Pratham,\n\n';
			emailBody += 'Name: ' + firstname + ' ' + lastname + '\n';
			emailBody += 'Email: ' + email + '\n\n';
			emailBody += 'Message:\n' + message + '\n\n';
			emailBody += 'Best regards,\n' + firstname + ' ' + lastname;
			
			// Create mailto link
			var mailtoLink = 'mailto:prathamssaraf@gmail.com';
			mailtoLink += '?subject=' + encodeURIComponent('Portfolio Contact: ' + subject);
			mailtoLink += '&body=' + encodeURIComponent(emailBody);
			
			// Show loading state briefly
			submitBtn.val('Opening Email...');
			submitBtn.prop('disabled', true);
			statusDiv.hide();
			
			setTimeout(function() {
				// Open email client
				window.location.href = mailtoLink;
				
				// Show success message
				statusDiv.html('<strong>Email client opened!</strong> Your default email app should open with the message pre-filled. Just click send!<br><br>If it didn\'t open, you can email me directly at <a href="mailto:prathamssaraf@gmail.com">prathamssaraf@gmail.com</a>');
				statusDiv.css({
					'background-color': '#d4edda',
					'border-color': '#c3e6cb',
					'color': '#155724'
				});
				statusDiv.show();
				
				// Reset button state
				submitBtn.val('Send Message');
				submitBtn.prop('disabled', false);
				
				// Reset form
				form.reset();
			}, 500);
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