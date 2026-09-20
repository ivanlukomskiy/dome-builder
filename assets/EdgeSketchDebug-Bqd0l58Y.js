import{i as e}from"./rolldown-runtime-Dd_uD5pT.js";import{$n as t,Ao as n,Bo as r,Br as i,Cn as a,Gn as o,Ha as s,Kn as c,Lr as l,Ur as u,Va as d,Vo as f,Wr as p,Xa as m,Zo as h,ft as g,gr as _,kt as v,po as y,za as b,zo as x}from"./polyhedra-D5Q2pMto.js";import{t as ee}from"./PerspectiveCamera-DXW7ivbH.js";import{a as te,d as ne,h as re,l as ie,m as S,p as C,s as ae,t as oe,u as w}from"./index-BiWlY0Py.js";var T=e(re(),1),E=new g,D=new r,O=class extends o{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new a([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new a([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new c(n,6,1);return this.setAttribute(`instanceStart`,new t(r,3,0)),this.setAttribute(`instanceEnd`,new t(r,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new c(n,6,1);return this.setAttribute(`instanceColorStart`,new t(r,3,0)),this.setAttribute(`instanceColorEnd`,new t(r,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new h(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new g);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),E.setFromBufferAttribute(t),this.boundingBox.union(E))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new m),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)D.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(D)),D.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(D));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}};S.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new x},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},C.line={uniforms:n.merge([S.common,S.fog,S.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {

			// compute the interpolation factor needed to trim the segment so it terminates
			// between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column

			// we need different nearEstimate formula for reversed and default depth buffer
			// a is positive with a reversed depth buffer so it can be used for controlling the code flow
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );

			return ( nearEstimate - start.z ) / ( end.z - start.z );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH

				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;

			#endif

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );

					#endif

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );

					#endif

				}

			}

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;

			#endif

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var k=class extends b{constructor(e){super({type:`LineMaterial`,uniforms:n.clone(C.line.uniforms),vertexShader:C.line.vertexShader,fragmentShader:C.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return`WORLD_UNITS`in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return`USE_DASH`in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return`USE_ALPHA_TO_COVERAGE`in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE=``:delete this.defines.USE_ALPHA_TO_COVERAGE)}},A=new f,se=new r,ce=new r,j=new f,M=new f,N=new f,P=new r,F=new u,I=new _,le=new r,L=new g,R=new m,z=new f,B,V;function H(e,t,n){return z.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),z.multiplyScalar(1/z.w),z.x=V/n.width,z.y=V/n.height,z.applyMatrix4(e.projectionMatrixInverse),z.multiplyScalar(1/z.w),Math.abs(Math.max(z.x,z.y))}function ue(e,t){let n=e.matrixWorld,i=e.geometry,a=i.attributes.instanceStart,o=i.attributes.instanceEnd,s=Math.min(i.instanceCount,a.count);for(let i=0,c=s;i<c;i++){I.start.fromBufferAttribute(a,i),I.end.fromBufferAttribute(o,i),I.applyMatrix4(n);let s=new r,c=new r;B.distanceSqToSegment(I.start,I.end,c,s),c.distanceTo(s)<V*.5&&t.push({point:c,pointOnLine:s,distance:B.origin.distanceTo(c),object:e,face:null,faceIndex:i,uv:null,uv1:null})}}function de(e,t,n){let a=t.projectionMatrix,o=e.material.resolution,s=e.matrixWorld,c=e.geometry,l=c.attributes.instanceStart,u=c.attributes.instanceEnd,d=Math.min(c.instanceCount,l.count),f=-t.near;B.at(1,N),N.w=1,N.applyMatrix4(t.matrixWorldInverse),N.applyMatrix4(a),N.multiplyScalar(1/N.w),N.x*=o.x/2,N.y*=o.y/2,N.z=0,P.copy(N),F.multiplyMatrices(t.matrixWorldInverse,s);for(let t=0,c=d;t<c;t++){if(j.fromBufferAttribute(l,t),M.fromBufferAttribute(u,t),j.w=1,M.w=1,j.applyMatrix4(F),M.applyMatrix4(F),j.z>f&&M.z>f)continue;if(j.z>f){let e=j.z-M.z,t=(j.z-f)/e;j.lerp(M,t)}else if(M.z>f){let e=M.z-j.z,t=(M.z-f)/e;M.lerp(j,t)}j.applyMatrix4(a),M.applyMatrix4(a),j.multiplyScalar(1/j.w),M.multiplyScalar(1/M.w),j.x*=o.x/2,j.y*=o.y/2,M.x*=o.x/2,M.y*=o.y/2,I.start.copy(j),I.start.z=0,I.end.copy(M),I.end.z=0;let c=I.closestPointToPointParameter(P,!0);I.at(c,le);let d=i.lerp(j.z,M.z,c),p=d>=-1&&d<=1,m=P.distanceTo(le)<V*.5;if(p&&m){I.start.fromBufferAttribute(l,t),I.end.fromBufferAttribute(u,t),I.start.applyMatrix4(s),I.end.applyMatrix4(s);let i=new r,a=new r;B.distanceSqToSegment(I.start,I.end,a,i),n.push({point:a,pointOnLine:i,distance:B.origin.distanceTo(a),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var fe=class extends p{constructor(e=new O,t=new k({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,n=e.attributes.instanceStart,r=e.attributes.instanceEnd,i=new Float32Array(2*n.count);for(let e=0,t=0,a=n.count;e<a;e++,t+=2)se.fromBufferAttribute(n,e),ce.fromBufferAttribute(r,e),i[t]=t===0?0:i[t-1],i[t+1]=i[t]+se.distanceTo(ce);let a=new c(i,2,1);return e.setAttribute(`instanceDistanceStart`,new t(a,1,0)),e.setAttribute(`instanceDistanceEnd`,new t(a,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;if(r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`),n===!1&&(this.material.resolution.x===0||this.material.resolution.y===0))return;let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;B=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;V=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),R.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?V*.5:H(r,Math.max(r.near,R.distanceToPoint(B.origin)),s.resolution),R.radius+=c,B.intersectsSphere(R)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),L.copy(o.boundingBox).applyMatrix4(a);let l;l=n?V*.5:H(r,Math.max(r.near,L.distanceToPoint(B.origin)),s.resolution),L.expandByScalar(l),B.intersectsBox(L)!==!1&&(n?ue(this,t):de(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(A),this.material.uniforms.resolution.value.set(A.z,A.w))}},U=class extends O{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setColors(n),this}setFromPoints(e){let t=e.length-1,n=new Float32Array(6*t);for(let r=0;r<t;r++)n[6*r]=e[r].x,n[6*r+1]=e[r].y,n[6*r+2]=e[r].z||0,n[6*r+3]=e[r+1].x,n[6*r+4]=e[r+1].y,n[6*r+5]=e[r+1].z||0;return super.setPositions(n),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},pe=class extends fe{constructor(e=new U,t=new k({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},W=ne(),G=Math.PI/180,K=`#5b9bd5`,me=`#f5a623`,q=`#2dd4bf`,J=`#e0729f`,he=`#5c6270`,ge=`#f5e050`,_e=`#4fd97e`;function ve(e,t){let n=Math.cos(t),r=Math.sin(t);return[e[0]*n-e[1]*r,e[0]*r+e[1]*n]}function ye(e){let t=e;for(;t<=-Math.PI;)t+=2*Math.PI;for(;t>Math.PI;)t-=2*Math.PI;return t}function be(e,t,n){let r=2*(e[0]*(t[1]-n[1])+t[0]*(n[1]-e[1])+n[0]*(e[1]-t[1])),i=e[0]*e[0]+e[1]*e[1],a=t[0]*t[0]+t[1]*t[1],o=n[0]*n[0]+n[1]*n[1];return[(i*(t[1]-n[1])+a*(n[1]-e[1])+o*(e[1]-t[1]))/r,(i*(n[0]-t[0])+a*(e[0]-n[0])+o*(t[0]-e[0]))/r]}function Y(e,t,n,r=32){let i=be(e,t,n),a=Math.hypot(e[0]-i[0],e[1]-i[1]),o=Math.atan2(e[1]-i[1],e[0]-i[0]),s=Math.atan2(t[1]-i[1],t[0]-i[0]),c=Math.atan2(n[1]-i[1],n[0]-i[0]),l=ye(s-o)+ye(c-s),u=[];for(let e=0;e<=r;e++){let t=o+e/r*l;u.push([i[0]+a*Math.cos(t),i[1]+a*Math.sin(t)])}return u}function X(e,t){let n=t(e.start),i=[new r(n[0],n[1],0)],a=n;for(let{to:n,seg:o}of e.path){let e=t(n);if(o.kind===`line`)i.push(new r(e[0],e[1],0));else{let n=t(o.via);for(let t of Y(a,n,e).slice(1))i.push(new r(t[0],t[1],0))}a=e}return i}function xe(e,t,n=!1){let i=[],a=t(e.start),o=a,s=(e,t,n)=>{let a=(t===`line`?[o,e]:Y(o,n,e)).map(e=>new r(e[0],e[1],0)),s=i[i.length-1];s&&s.kind===t?s.points.push(...a.slice(1)):i.push({kind:t,points:a}),o=e};for(let{to:n,seg:r}of e.path){let e=t(n);r.kind===`line`?s(e,`line`):s(e,`arc`,t(r.via))}return n&&s(a,`line`),i}function Se(e,t=96){let n=[];for(let i=0;i<=t;i++){let a=i/t*Math.PI*2;n.push(new r(e*Math.cos(a),e*Math.sin(a),-1))}return n}function Z({points:e,color:t,z:n=0,width:r=3,dashed:i=!1,closed:a=!1}){let{size:o}=ie(e=>e),s=(0,T.useMemo)(()=>{let s=[],c=a?[...e,e[0]]:e;for(let e of c)s.push(e.x,e.y,n);let l=new U;l.setPositions(s);let u=new pe(l,new k({color:new v(t).getHex(),linewidth:r,dashed:i,dashSize:14,gapSize:10,resolution:new x(o.width,o.height)}));return i&&u.computeLineDistances(),u},[e,n,t,r,i,a,o.width,o.height]);return(0,W.jsx)(`primitive`,{object:s})}function Q({position:e,color:t}){return(0,W.jsxs)(`mesh`,{position:[e[0],e[1],1],children:[(0,W.jsx)(`circleGeometry`,{args:[18,24]}),(0,W.jsx)(`meshBasicMaterial`,{color:t})]})}function Ce({boundary:e,centerline:t,vertexA:n,vertexB:i,radius:a,angleDeg:o}){let c=(0,T.useMemo)(()=>Math.PI/2-o*G/2,[o]),l=(0,T.useMemo)(()=>e=>ve(e,c),[c]),u=(0,T.useMemo)(()=>X(e,l),[e,l]),f=(0,T.useMemo)(()=>X(t,l),[t,l]),p=(0,T.useMemo)(()=>xe(e,l,!0),[e,l]),m=(0,T.useMemo)(()=>xe(t,l),[t,l]),h=(0,T.useMemo)(()=>Se(a),[a]),g=(0,T.useMemo)(()=>{let e=new d(u.map(e=>new x(e.x,e.y)));return new s(e)},[u]),_=l(n),v=l(i),y=[0,0],b=(0,T.useMemo)(()=>[new r(_[0],_[1],0),f[0]],[_,f]),ee=(0,T.useMemo)(()=>[f[f.length-1],new r(v[0],v[1],0)],[v,f]);return(0,W.jsxs)(`group`,{children:[(0,W.jsx)(Z,{points:h,color:he,width:1.5,dashed:!0,closed:!0}),(0,W.jsx)(`mesh`,{geometry:g,position:[0,0,0],children:(0,W.jsx)(`meshBasicMaterial`,{color:K,transparent:!0,opacity:.2,side:2})}),p.map((e,t)=>(0,W.jsx)(Z,{points:e.points,color:e.kind===`arc`?q:K,z:.1,width:3},`boundary-${t}`)),m.map((e,t)=>(0,W.jsx)(Z,{points:e.points,color:e.kind===`arc`?q:me,z:.2,width:4,dashed:!0},`centerline-${t}`)),(0,W.jsx)(Z,{points:b,color:J,z:.2,width:4,dashed:!0}),(0,W.jsx)(Z,{points:ee,color:J,z:.2,width:4,dashed:!0}),(0,W.jsx)(Q,{position:y,color:ge}),(0,W.jsx)(Q,{position:_,color:_e}),(0,W.jsx)(Q,{position:v,color:_e})]})}function we(e){let[t]=(0,T.useState)(()=>{let t=Math.PI/2-e.angleDeg*G/2,n=e=>ve(e,t),r=[...X(e.boundary,n),...X(e.centerline,n)],i=r.map(e=>e.x),a=r.map(e=>e.y),o=Math.min(...i),s=Math.max(...i),c=Math.min(...a),l=Math.max(...a),u=s-o,d=l-c,f=Math.max(u,d,100)/2/Math.tan(45*G/2)*1.7;return{target:[(o+s)/2,(c+l)/2,0],distance:f,fov:45}});return t}function Te(e){let{target:t,distance:n,fov:r}=we(e);return(0,W.jsxs)(ae,{children:[(0,W.jsx)(`color`,{attach:`background`,args:[`#12141a`]}),(0,W.jsx)(ee,{makeDefault:!0,position:[t[0],t[1],t[2]+n],up:[0,1,0],fov:r,near:1,far:n*100}),(0,W.jsx)(te,{makeDefault:!0,enableRotate:!1,target:t,enableDamping:!0,dampingFactor:.08,mouseButtons:{LEFT:l.PAN,MIDDLE:l.DOLLY,RIGHT:l.PAN},touches:{ONE:y.PAN,TWO:y.DOLLY_PAN}}),(0,W.jsx)(Ce,{...e})]})}var $=Math.PI/180,Ee={offset1:100,offset2:100,width:125,cornerLength:375,radius:2500,angleDeg:60,toothHeight:30,toothLength:60,toothChamfer:8,millRadius:6};function De(){let[e,t]=(0,T.useState)(Ee),n=e=>n=>t(t=>({...t,[e]:n})),i=(0,T.useMemo)(()=>{let{radius:t,angleDeg:n,offset1:i,offset2:a,cornerLength:o,width:s,toothHeight:c,toothLength:l,toothChamfer:u,millRadius:d}=e,f=new r(0,0,0),p=n*$,m=new r(t,0,0),h=new r(t*Math.cos(p),t*Math.sin(p),0);return oe(m,h,f,i,a,o,s/2,{height:c,length:l,chamfer:u,millRadius:d})},[e]),a=[e.radius,0],o=[e.radius*Math.cos(e.angleDeg*$),e.radius*Math.sin(e.angleDeg*$)];return(0,W.jsxs)(`div`,{className:`app`,children:[(0,W.jsxs)(`aside`,{className:`sidebar`,children:[(0,W.jsx)(`h1`,{children:`Edge Sketch Debug`}),(0,W.jsx)(`div`,{className:`button-row`,children:(0,W.jsx)(`a`,{href:`/dome-builder/`,children:`← Back to builder`})}),(0,W.jsxs)(`section`,{className:`control-group`,children:[(0,W.jsx)(`h2`,{children:`Vertex Placement`}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Radius from center (mm)`}),(0,W.jsx)(w,{value:e.radius,step:50,min:1,onCommit:n(`radius`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Angle between radiuses (deg)`}),(0,W.jsx)(w,{value:e.angleDeg,step:1,onCommit:n(`angleDeg`)})]})]}),(0,W.jsxs)(`section`,{className:`control-group`,children:[(0,W.jsx)(`h2`,{children:`Edge End Offsets`}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Offset 1 (mm)`}),(0,W.jsx)(w,{value:e.offset1,step:5,min:0,onCommit:n(`offset1`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Offset 2 (mm)`}),(0,W.jsx)(w,{value:e.offset2,step:5,min:0,onCommit:n(`offset2`)})]})]}),(0,W.jsxs)(`section`,{className:`control-group`,children:[(0,W.jsx)(`h2`,{children:`Strut Shape`}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Width (mm)`}),(0,W.jsx)(w,{value:e.width,step:5,min:0,onCommit:n(`width`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Corner length (mm)`}),(0,W.jsx)(w,{value:e.cornerLength,step:5,min:0,onCommit:n(`cornerLength`)})]})]}),(0,W.jsxs)(`section`,{className:`control-group`,children:[(0,W.jsx)(`h2`,{children:`Corner Teeth`}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Tooth height (mm)`}),(0,W.jsx)(w,{value:e.toothHeight,step:5,min:0,onCommit:n(`toothHeight`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Tooth length (mm)`}),(0,W.jsx)(w,{value:e.toothLength,step:5,min:0,onCommit:n(`toothLength`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Chamfer length (mm)`}),(0,W.jsx)(w,{value:e.toothChamfer,step:1,min:0,onCommit:n(`toothChamfer`)})]}),(0,W.jsxs)(`div`,{className:`transform-field`,children:[(0,W.jsx)(`label`,{children:`Mill radius (mm)`}),(0,W.jsx)(w,{value:e.millRadius,step:1,min:0,onCommit:n(`millRadius`)})]}),(0,W.jsx)(`p`,{className:`hint`,children:`A tooth appears at each vertex end, on both the outer and inner boundary (mirrored across the centerline). 0 height turns it off. The mill radius sets a dogbone relief cut into the main line at each of the tooth's two concave base corners - the corner itself stays sharp, but a real round cutting bit can't reach all the way into it, so a semicircle is cut in just before, leaving room for a square mating part to seat flush.`})]}),(0,W.jsxs)(`section`,{className:`control-group`,children:[(0,W.jsx)(`h2`,{children:`Legend`}),(0,W.jsx)(`p`,{className:`hint`,style:{color:`#5b9bd5`},children:`Boundary - the actual sketch outline`}),(0,W.jsx)(`p`,{className:`hint`,style:{color:`#f5a623`},children:`Centerline - the trimmed, mitered main line`}),(0,W.jsx)(`p`,{className:`hint`,style:{color:`#2dd4bf`},children:`Arc section - of either line above`}),(0,W.jsx)(`p`,{className:`hint`,style:{color:`#e0729f`},children:`Offset line - vertex to where the centerline starts`})]})]}),(0,W.jsx)(`div`,{className:`viewport`,children:i?(0,W.jsx)(Te,{boundary:i,centerline:i.centerline,vertexA:a,vertexB:o,radius:e.radius,angleDeg:e.angleDeg}):(0,W.jsx)(`div`,{className:`hud`,children:`Degenerate configuration - a vertex sits on the gravity center.`})})]})}export{De as EdgeSketchDebug};